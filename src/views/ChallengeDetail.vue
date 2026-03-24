<script setup>
import { ref, computed, onUnmounted, watch } from 'vue'
import { doc, collection, query, where, getDocs, updateDoc, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db, functions } from '../firebase'
import { getChallengeById } from '../data/challenges'
import { useGameState } from '../composables/useGameState'
import { ArrowLeft, Play, Square, Target, XCircle, PauseCircle } from 'lucide-vue-next'

const props = defineProps({
  teamId: String,
  challengeId: String,
})

const router = useRouter()
const challenge = getChallengeById(props.challengeId)
const { roundDurationMinutes, isPaused } = useGameState()

// Pause the local countdown when the game is paused
watch(isPaused, (paused) => {
  if (paused && timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
    // Keep isRunning true so we know to resume on unpause
  }
  if (!paused && isRunning.value && challengeResult.value?.status === 'in_progress') {
    // Resume countdown from startedAt
    const startTime = challengeResult.value.startedAt?.toDate
      ? challengeResult.value.startedAt.toDate()
      : new Date(challengeResult.value.startedAt)
    startCountdown(startTime)
  }
})
const teamRef = doc(db, 'teams', props.teamId)
const team = useDocument(teamRef)
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))

// Challenge timer = round duration (minutes) × challenge multiplier
const maxTimeSeconds = computed(() => {
  const multiplier = challenge?.timerMultiplier ?? 1
  return Math.round(roundDurationMinutes.value * 60 * multiplier)
})

const timerDisplay = ref('--:--.0')
const elapsedMs = ref(0)
const timerInterval = ref(null)
const isRunning = ref(false)
const targetsHit = ref(0)
const submitting = ref(false)

const hasTime = computed(() => challenge?.factors?.includes('timeSpent'))
const hasTargets = computed(() => challenge?.factors?.includes('targetsHit'))
const maxTargets = computed(() => challenge?.maxTargets ?? 1)
const isTargetsOnly = computed(() => hasTargets.value && !hasTime.value)
// If the challenge has a successThreshold, it gates which button is active
const successThreshold = computed(() => challenge?.successThreshold ?? null)
const isAboveThreshold = computed(() =>
  successThreshold.value === null || targetsHit.value >= successThreshold.value
)
const isBelowThreshold = computed(() =>
  successThreshold.value !== null && targetsHit.value < successThreshold.value
)

// The Firestore document for this specific challenge in the subcollection
const challengeResult = computed(() =>
  challengeDocs.value?.find((d) => d.challengeId === props.challengeId) ?? null
)

const isCompleted = computed(() => {
  const s = challengeResult.value?.status
  return s === 'completed' || s === 'failed'
})

// Helper: get the subcollection doc ref for this challenge
async function getChallengeDocRef() {
  const q = query(
    collection(db, 'teams', props.teamId, 'challenges'),
    where('challengeId', '==', props.challengeId)
  )
  const snap = await getDocs(q)
  if (snap.empty) {
    const ref = doc(db, 'teams', props.teamId, 'challenges', props.challengeId)
    await setDoc(ref, {
      teamId: props.teamId,
      challengeId: props.challengeId,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      failed: false,
      score: 0,
      factors: {},
    }, { merge: true })
    return ref
  }
  return snap.docs[0].ref
}

// Stop timer as soon as challenge is completed or failed
watch(isCompleted, (done) => {
  if (done && timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
    isRunning.value = false
  }
})

// Restore timer if already in progress
watch(challengeResult, (result) => {
  if (!result) return
  if (result.status === 'in_progress' && result.startedAt && !isRunning.value) {
    const startTime = result.startedAt.toDate ? result.startedAt.toDate() : new Date(result.startedAt)
    const now = new Date()
    const diffMs = now - startTime
    if (diffMs < maxTimeSeconds.value * 1000) {
      elapsedMs.value = diffMs
      startCountdown(startTime)
    }
  }
}, { immediate: true })

function startCountdown(startTime) {
  isRunning.value = true
  timerInterval.value = setInterval(() => {
    if (isCompleted.value) {
      clearInterval(timerInterval.value)
      timerInterval.value = null
      isRunning.value = false
      return
    }
    const now = new Date()
    const diffMs = now - startTime
    elapsedMs.value = diffMs
    const remainingMs = Math.max(0, maxTimeSeconds.value * 1000 - diffMs)
    const totalSec = Math.floor(remainingMs / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    const tenths = Math.floor((remainingMs % 1000) / 100)
    timerDisplay.value = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`

    if (remainingMs <= 0) {
      clearInterval(timerInterval.value)
      timerInterval.value = null
      isRunning.value = false
      markFailed({ timedOut: true })
    }
  }, 100)
}

async function startChallenge() {
  const now = new Date()
  const ref = await getChallengeDocRef()
  await updateDoc(ref, { status: 'in_progress', startedAt: now })
  if (!isTargetsOnly.value) {
    startCountdown(now)
  } else {
    isRunning.value = true
  }
}

async function completeChallenge() {
  if (submitting.value) return
  submitting.value = true
  clearInterval(timerInterval.value)
  timerInterval.value = null
  isRunning.value = false

  const factors = {}
  if (hasTime.value) {
    factors.timeSpent = Math.round(elapsedMs.value / 1000)
    factors.maxTimeSeconds = maxTimeSeconds.value
  }
  if (hasTargets.value) factors.targetsHit = targetsHit.value

  try {
    const calculateScore = httpsCallable(functions, 'calculateScore')
    await calculateScore({ teamId: props.teamId, challengeId: props.challengeId, factors })
  } catch (e) {
    console.error('Score calculation failed:', e)
    const ref = await getChallengeDocRef()
    await updateDoc(ref, {
      status: 'completed',
      completedAt: new Date(),
      factors,
    })
  } finally {
    submitting.value = false
  }
}

async function markFailed(options = {}) {
  if (submitting.value) return
  submitting.value = true
  clearInterval(timerInterval.value)
  timerInterval.value = null
  isRunning.value = false

  const timedOut = !!options.timedOut

  const factors = {}
  if (hasTime.value) {
    factors.timeSpent = Math.round(elapsedMs.value / 1000)
    factors.maxTimeSeconds = maxTimeSeconds.value
  }
  if (hasTargets.value) factors.targetsHit = targetsHit.value

  try {
    await httpsCallable(functions, 'markFailed')({
      teamId: props.teamId,
      challengeId: props.challengeId,
      factors,
      timedOut,
    })
  } catch (e) {
    console.error('markFailed cloud function failed:', e)
    // Fallback: write directly with score 0
    const ref = await getChallengeDocRef()
    await updateDoc(ref, {
      status: 'failed',
      failed: true,
      score: 0,
      completedAt: new Date(),
      factors,
    })
  } finally {
    submitting.value = false
  }
}

const timerColor = computed(() => {
  const remainingSec = maxTimeSeconds.value - elapsedMs.value / 1000
  if (remainingSec <= 60) return 'text-red-400'
  if (remainingSec <= 180) return 'text-amber-400'
  return 'text-emerald-400'
})

const teamLabel = computed(() => {
  const displayName = team.value?.displayName
  const name = team.value?.name
  if (!displayName && !name) return '—'
  if (!displayName || !name) return displayName ?? name
  return `${displayName} (${name})`
})

onUnmounted(() => {
  if (timerInterval.value) clearInterval(timerInterval.value)
})
</script>

<template>
  <div class="min-h-screen">
    <!-- Header (fixed to top) -->
    <div class="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 p-6">
      <div class="max-w-lg mx-auto flex items-center gap-3">
        <button
          @click="router.push({ name: 'TeamDashboard', params: { teamId } })"
          class="text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div>
          <h1 class="text-2xl font-bold">{{ challenge?.icon }} {{ challenge?.name }}</h1>
          <p class="text-slate-400 text-sm">{{ teamLabel }}</p>
        </div>
      </div>
    </div>

    <!-- Main content with top padding -->
    <div class="max-w-lg mx-auto p-6 pt-28">
    <!-- Summary -->
    <div class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 mb-6">
      <p class="text-slate-300 leading-relaxed">{{ challenge?.summary }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <span
          v-for="f in challenge?.factors"
          :key="f"
          class="text-xs bg-slate-700/50 text-slate-300 px-2 py-1 rounded-full"
        >
          {{ f === 'timeSpent' ? '⏱ Time' : f === 'targetsHit' ? '🎯 Targets' : f }}
        </span>
      </div>
    </div>

    <!-- Timer (hidden for targets-only challenges) -->
    <div v-if="hasTime" class="text-center mb-8">
      <p
        class="text-7xl font-mono font-bold tabular-nums transition-colors"
        :class="isRunning ? timerColor : 'text-slate-500'"
      >
        {{ timerDisplay }}
      </p>
      <p class="text-slate-500 text-sm mt-2">
        {{ isRunning ? 'Temps restant' : isCompleted ? 'Épreuve terminée' : 'Prêt à démarrer' }}
      </p>
    </div>

    <!-- Targets input (if applicable) -->
    <div v-if="hasTargets && (isRunning || isTargetsOnly) && !isCompleted" class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 mb-6">
      <label class="flex items-center gap-2 text-sm font-medium text-slate-300 mb-3">
        <Target class="w-4 h-4 text-amber-400" />
        Cibles touchées
        <span v-if="successThreshold !== null" class="ml-auto text-xs font-normal text-slate-400">
          Seuil réussite : <span class="font-semibold" :class="targetsHit >= successThreshold ? 'text-emerald-400' : 'text-red-400'">{{ successThreshold }}/{{ maxTargets }}</span>
        </span>
      </label>
      <div class="flex items-center gap-3">
        <button
          @click="targetsHit = Math.max(0, targetsHit - 1)"
          class="bg-slate-700 hover:bg-slate-600 w-10 h-10 rounded-xl text-lg font-bold transition-colors"
        >
          −
        </button>
        <span class="text-3xl font-bold tabular-nums w-16 text-center">{{ targetsHit }}<span class="text-base text-slate-500">/{{ maxTargets }}</span></span>
        <button
          @click="targetsHit = Math.min(maxTargets, targetsHit + 1)"
          :disabled="targetsHit >= maxTargets"
          class="bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed w-10 h-10 rounded-xl text-lg font-bold transition-colors"
        >
          +
        </button>
      </div>
    </div>

    <!-- Paused overlay -->
    <div v-if="isPaused" class="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 mb-4 flex items-center gap-3">
      <PauseCircle class="w-6 h-6 text-amber-400 shrink-0" />
      <div>
        <p class="font-semibold text-amber-400">Jeu en pause</p>
        <p class="text-slate-400 text-sm">Le minuteur est suspendu. Attendez la reprise.</p>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="!isCompleted && !isPaused" class="flex gap-3">
      <button
        v-if="!isRunning"
        @click="startChallenge"
        class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
      >
        <Play class="w-5 h-5" />
        Lancer l'épreuve
      </button>

      <template v-if="isRunning">
        <!-- Complete: shown when no threshold, or targets >= threshold -->
        <button
          v-if="!hasTargets || isAboveThreshold"
          @click="completeChallenge"
          :disabled="submitting"
          class="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          <Square class="w-5 h-5" />
          Réussi
        </button>
        <!-- Fail: shown when no threshold, or targets < threshold -->
        <button
          v-if="!hasTargets || isBelowThreshold"
          @click="markFailed()"
          :disabled="submitting"
          :class="isBelowThreshold
            ? 'flex-1 bg-red-500 hover:bg-red-400 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors'
            : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold px-6 py-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-red-500/30'"
        >
          <XCircle class="w-5 h-5" />
          Échoué
        </button>
      </template>
    </div>

    <!-- Result display -->
    <div v-if="isCompleted" class="text-center">
      <div
        v-if="challengeResult?.status === 'completed'"
        class="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6"
      >
        <p class="text-emerald-400 font-semibold text-lg mb-1">Épreuve réussie !</p>
        <p class="text-4xl font-extrabold text-emerald-400">+{{ challengeResult.score }} pts</p>
      </div>
      <div
        v-else
        class="bg-red-500/10 border border-red-500/30 rounded-2xl p-6"
      >
        <p class="text-red-400 font-semibold text-lg mb-1">Épreuve échouée</p>
        <p v-if="challengeResult?.score < 0" class="text-3xl font-extrabold text-red-400">{{ challengeResult.score }} pts</p>
        <p v-else-if="challengeResult?.score > 0" class="text-3xl font-extrabold text-red-400">+{{ challengeResult.score }} pts</p>
        <p v-else class="text-slate-400">Aucun point attribué</p>
        <p v-if="challengeResult?.timedOut" class="text-xs text-red-400/70 mt-1">Pénalité temps écoulé : −500 pts</p>
        <p v-else-if="challengeResult?.score > 0" class="text-xs text-slate-500 mt-1">Score partiel pour les cibles touchées</p>
      </div>
    </div>
    </div>
  </div>
</template>
