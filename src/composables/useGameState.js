import { computed, ref, watch, onUnmounted } from 'vue'
import { doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useDocument } from 'vuefire'
import { db, functions } from '../firebase'
import { CHALLENGES } from '../data/challenges'

const DEFAULT_ROUND_DURATION_MINUTES = 15

export function useGameState() {
  const gameRef = doc(db, 'games', 'current')
  const game = useDocument(gameRef)

  // Track which round we already auto-advanced, to avoid firing twice
  let autoAdvancedRound = -1
  let autoAdvancing = false

  const isWaiting = computed(() => !game.value || game.value.status === 'waiting')
  const isActive = computed(() => game.value?.status === 'active')
  const isPaused = computed(() => game.value?.status === 'paused')
  const isFinal = computed(() => game.value?.status === 'final')
  const isFinished = computed(() => game.value?.status === 'finished')

  const currentRound = computed(() => game.value?.currentRound ?? 0)
  const totalRounds = computed(() => game.value?.totalRounds ?? CHALLENGES.length)

  // Round countdown timer
  const roundTimeRemaining = ref(0)
  const roundTimerDisplay = ref('--:--')
  let timerInterval = null

  // Global timer = configured duration × 1.2
  const roundDurationMinutes = computed(() => game.value?.roundDurationMinutes ?? DEFAULT_ROUND_DURATION_MINUTES)
  const globalTimerSeconds = computed(() => Math.round(roundDurationMinutes.value * 60 * 1.2))

  function updateRoundTimer() {
    const status = game.value?.status
    if (status === 'paused' && game.value.pausedRemainingMs != null) {
      const remaining = Math.floor(game.value.pausedRemainingMs / 1000)
      roundTimeRemaining.value = remaining
      const mins = Math.floor(remaining / 60)
      const secs = remaining % 60
      roundTimerDisplay.value = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} ⏸`
      return
    }
    if (!game.value || status !== 'active' || !game.value.roundStartedAt) {
      roundTimeRemaining.value = 0
      roundTimerDisplay.value = '--:--'
      return
    }
    const startedAt = game.value.roundStartedAt.toDate
      ? game.value.roundStartedAt.toDate()
      : new Date(game.value.roundStartedAt)
    const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000)
    const remaining = Math.max(0, globalTimerSeconds.value - elapsed)
    roundTimeRemaining.value = remaining
    const mins = Math.floor(remaining / 60)
    const secs = remaining % 60
    roundTimerDisplay.value = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

    // Low-latency: let any connected signed-in client trigger server-validated auto-advance
    if (remaining === 0) {
      const round = game.value?.currentRound ?? 0
      if (round !== autoAdvancedRound && !autoAdvancing) {
        autoAdvancedRound = round
        autoAdvancing = true
        httpsCallable(functions, 'autoAdvanceIfElapsed')()
          .catch((e) => console.error('Auto-advance failed:', e))
          .finally(() => { autoAdvancing = false })
      }
    }
  }

  // Final phase countdown
  const finalTimerDisplay = ref('--:--')
  const finalTimeRemaining = ref(0)
  const FINAL_DURATION_SECONDS = 5 * 60
  let autoEndedFinal = false
  let autoEnding = false

  function updateFinalTimer() {
    if (game.value?.status !== 'final' || !game.value.finalStartedAt) {
      finalTimerDisplay.value = '--:--'
      finalTimeRemaining.value = 0
      return
    }
    const startedAt = game.value.finalStartedAt.toDate
      ? game.value.finalStartedAt.toDate()
      : new Date(game.value.finalStartedAt)
    const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000)
    const remaining = Math.max(0, FINAL_DURATION_SECONDS - elapsed)
    finalTimeRemaining.value = remaining
    const mins = Math.floor(remaining / 60)
    const secs = remaining % 60
    finalTimerDisplay.value = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

    if (remaining === 0 && !autoEndedFinal && !autoEnding) {
      autoEndedFinal = true
      autoEnding = true
      httpsCallable(functions, 'autoEndFinalIfElapsed')()
        .catch((e) => console.error('Auto-end final failed:', e))
        .finally(() => { autoEnding = false })
    }
  }

  watch(game, () => {
    updateRoundTimer()
    updateFinalTimer()
    if (timerInterval) clearInterval(timerInterval)
    if (game.value?.status === 'active') {
      timerInterval = setInterval(updateRoundTimer, 500)
    } else if (game.value?.status === 'final') {
      timerInterval = setInterval(updateFinalTimer, 500)
    }
  }, { immediate: true })

  onUnmounted(() => {
    if (timerInterval) clearInterval(timerInterval)
  })

  // Get the current challenge ID for a team based on its challengeOrder and the current round
  function getCurrentChallengeForTeam(team) {
    if (!team?.challengeOrder || !isActive.value) return null
    const round = currentRound.value
    if (round >= team.challengeOrder.length) return null
    return team.challengeOrder[round]
  }

  // Get the ordered list of challenge definitions for a team
  function getOrderedChallenges(team) {
    if (!team?.challengeOrder) return CHALLENGES
    return team.challengeOrder.map((id) => CHALLENGES.find((c) => c.id === id)).filter(Boolean)
  }

  return {
    game,
    isWaiting,
    isActive,
    isPaused,
    isFinal,
    isFinished,
    currentRound,
    totalRounds,
    roundDurationMinutes,
    roundTimeRemaining,
    roundTimerDisplay,
    finalTimerDisplay,
    finalTimeRemaining,
    getCurrentChallengeForTeam,
    getOrderedChallenges,
  }
}
