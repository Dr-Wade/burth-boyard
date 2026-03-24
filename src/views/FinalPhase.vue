<script setup>
import { ref, computed } from 'vue'
import { doc, collection } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db, functions } from '../firebase'
import { useAuth } from '../composables/useAuth'
import { useGameState } from '../composables/useGameState'
import { ArrowLeft, Clock, Lightbulb, KeyRound, ShoppingCart, Trophy, Lock } from 'lucide-vue-next'

const props = defineProps({ teamId: String })
const router = useRouter()
const { userProfile } = useAuth()
const { game, isFinal, isFinished, finalTimerDisplay, finalTimeRemaining } = useGameState()

const finalExpired = computed(() => isFinished.value || finalTimeRemaining.value === 0)

const teamRef = doc(db, 'teams', props.teamId)
const team = useDocument(teamRef)
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))

const guess = ref('')
const submitting = ref(false)
const buying = ref(false)
const guessResult = ref(null) // null | 'correct' | 'wrong'
const errorMsg = ref(null)

// Number of completed challenges unlocks that many free hints
const completedCount = computed(() => {
  if (team.value?.completedChallenges != null) return team.value.completedChallenges
  if (!challengeDocs.value) return 0
  return challengeDocs.value.filter(d => d.status === 'completed').length
})

const boughtHints = computed(() => team.value?.boughtHints ?? 0)
const hasGuessed = computed(() => team.value?.hasGuessed ?? false)
const guessCorrect = computed(() => team.value?.guessCorrect ?? false)

const allHints = computed(() => team.value?.finalHints ?? [])

// 1 completed challenge = 0.5 free hints (floor)
const freeHintsCount = computed(() => Math.min(Math.floor(completedCount.value / 2), allHints.value.length))
const totalUnlockedHints = computed(() => Math.min(freeHintsCount.value + boughtHints.value, allHints.value.length))
const visibleHints = computed(() => allHints.value.slice(0, totalUnlockedHints.value))

const maxBoughtHints = 6
const hintCost = 2000
const canBuyMore = computed(() =>
  !hasGuessed.value &&
  !finalExpired.value &&
  boughtHints.value < maxBoughtHints &&
  totalUnlockedHints.value < allHints.value.length &&
  (team.value?.totalScore ?? 0) >= hintCost
)

const teamLabel = computed(() => {
  const displayName = team.value?.displayName
  const name = team.value?.name
  if (!displayName && !name) return '—'
  if (!displayName || !name) return displayName ?? name
  return `${displayName} (${name})`
})

async function handleBuyHint() {
  buying.value = true
  errorMsg.value = null
  try {
    await httpsCallable(functions, 'buyHint')({ teamId: props.teamId })
  } catch (e) {
    errorMsg.value = e.message ?? 'Failed to purchase hint.'
  } finally {
    buying.value = false
  }
}

async function handleSubmitGuess() {
  if (!guess.value.trim() || hasGuessed.value) return
  submitting.value = true
  errorMsg.value = null
  try {
    const { data } = await httpsCallable(functions, 'submitGuess')({
      teamId: props.teamId,
      guess: guess.value.trim(),
    })
    guessResult.value = data.correct ? 'correct' : 'wrong'
  } catch (e) {
    errorMsg.value = e.message ?? 'Failed to submit guess.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header (fixed to top) -->
    <div class="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 p-6">
      <div class="max-w-lg mx-auto flex items-center gap-3">
        <button @click="router.push({ name: 'TeamDashboard', params: { teamId } })" class="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div class="flex-1">
          <h1 class="text-2xl font-bold flex items-center gap-2">
            🏯 Phase Finale
          </h1>
          <p class="text-slate-400 text-sm">{{ teamLabel }}</p>
        </div>
        <!-- Timer -->
        <div class="text-right">
          <p class="text-xl font-mono font-bold text-amber-400 flex items-center gap-1.5">
            <Clock class="w-4 h-4" />
            {{ finalTimerDisplay }}
          </p>
        </div>
      </div>
    </div>

    <div class="max-w-lg mx-auto p-6 pt-28 space-y-6">

      <!-- Score -->
      <div class="bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-2xl p-5 flex items-center gap-4">
        <Trophy class="w-8 h-8 text-amber-400 shrink-0" />
        <div>
          <p class="text-slate-300 text-sm">Current score</p>
          <p class="text-3xl font-extrabold text-amber-400">{{ team?.totalScore ?? 0 }} pts</p>
        </div>
      </div>

      <!-- Already guessed result -->
      <div v-if="hasGuessed">
        <div v-if="guessCorrect || team?.guessCorrect"
          class="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
          <p class="text-4xl mb-2">🎉</p>
          <p class="text-emerald-400 font-bold text-xl mb-1">Bonne réponse !</p>
          <p class="text-slate-300">+10 000 points bonus</p>
          <p class="text-slate-400 text-sm mt-1">Mot : <span class="text-white font-semibold">{{ team?.guess }}</span></p>
        </div>
        <div v-else class="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center">
          <p class="text-4xl mb-2">❌</p>
          <p class="text-red-400 font-bold text-xl mb-1">Mauvaise réponse</p>
          <p class="text-slate-400 text-sm mt-1">Votre réponse : <span class="text-white font-semibold">{{ team?.guess }}</span></p>
        </div>
      </div>

      <!-- Hints section -->
      <div class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-semibold flex items-center gap-2">
            <Lightbulb class="w-5 h-5 text-amber-400" />
            Indices
          </h2>
          <span class="text-xs text-slate-400">{{ totalUnlockedHints }} / {{ allHints.length }} débloqués</span>
        </div>

        <!-- Visible hints -->
        <div class="space-y-2 mb-4">
          <div v-for="(hint, i) in visibleHints" :key="i"
            class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
            <span class="text-amber-400 font-bold text-sm shrink-0 mt-0.5">#{{ i + 1 }}</span>
            <p class="text-slate-200 text-sm">{{ hint }}</p>
          </div>
          <!-- Locked hint placeholders -->
          <div v-for="i in (allHints.length - totalUnlockedHints)" :key="'locked-' + i"
            class="flex items-center gap-3 bg-slate-700/20 border border-slate-700/30 rounded-xl px-4 py-3 opacity-50">
            <Lock class="w-4 h-4 text-slate-500 shrink-0" />
            <p class="text-slate-500 text-sm italic">Indice verrouillé</p>
          </div>
        </div>

        <!-- Buy hint button -->
        <button
          v-if="!hasGuessed && !finalExpired && totalUnlockedHints < allHints.length"
          @click="handleBuyHint"
          :disabled="buying || !canBuyMore"
          class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-colors text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canBuyMore
            ? 'bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/20'
            : 'bg-slate-700/30 border-slate-600/30 text-slate-500'"
        >
          <ShoppingCart class="w-4 h-4" />
          {{ buying ? 'Achat…' : `Acheter un indice (−${hintCost} pts)` }}
        </button>
        <p v-if="!canBuyMore && !hasGuessed && totalUnlockedHints < allHints.value?.length" class="text-xs text-slate-500 text-center mt-2">
          {{ (team?.totalScore ?? 0) < hintCost ? 'Pas assez de points' : 'Maximum atteint' }}
        </p>
      </div>

      <!-- Time expired banner -->
      <div v-if="finalExpired && !hasGuessed" class="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 text-center">
        <p class="text-3xl mb-2">⏱</p>
        <p class="text-red-400 font-bold text-lg">Temps écoulé !</p>
        <p class="text-slate-400 text-sm mt-1">La phase finale est terminée. Plus aucune réponse n'est acceptée.</p>
      </div>

      <!-- Guess form -->
      <div v-if="!hasGuessed && !finalExpired" class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
        <h2 class="font-semibold flex items-center gap-2 mb-4">
          <KeyRound class="w-5 h-5 text-amber-400" />
          Devinez le mot secret
        </h2>
        <p class="text-xs text-red-400/80 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          ⚠️ Une seule tentative. Réfléchissez bien avant de soumettre.
        </p>
        <form @submit.prevent="handleSubmitGuess" class="flex gap-3">
          <input
            v-model="guess"
            required
            placeholder="Votre réponse…"
            :disabled="submitting"
            class="flex-1 bg-slate-900/60 border border-slate-700/60 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            :disabled="!guess.trim() || submitting"
            class="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold px-5 py-3 rounded-xl transition-colors shrink-0"
          >
            {{ submitting ? '…' : 'Envoyer' }}
          </button>
        </form>
        <p v-if="errorMsg" class="text-sm text-red-400 mt-2">{{ errorMsg }}</p>
      </div>

    </div>
  </div>
</template>
