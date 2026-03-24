<script setup>
import { computed, ref, watch, watchEffect } from 'vue'
import { doc, collection, updateDoc } from 'firebase/firestore'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db } from '../firebase'
import { CHALLENGES, getChallengeById } from '../data/challenges'
import { useGameState } from '../composables/useGameState'
import { useAuth } from '../composables/useAuth'
import { Trophy, ArrowLeft, ChevronRight, Clock, Swords } from 'lucide-vue-next'

const props = defineProps({
  teamId: String,
})

const router = useRouter()
const teamRef = doc(db, 'teams', props.teamId)
const team = useDocument(teamRef)
const { userProfile, isTeamLeader } = useAuth()
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))
const { isWaiting, isActive, isPaused, isFinal, currentRound, totalRounds, roundTimerDisplay, getCurrentChallengeForTeam, getOrderedChallenges } = useGameState()

const editingDisplayName = ref(false)
const displayNameInput = ref('')
const savingDisplayName = ref(false)
const displayNameError = ref(null)

const teamLabel = computed(() => {
  const displayName = team.value?.displayName
  const name = team.value?.name
  if (!displayName && !name) return 'Loading...'
  if (!displayName || !name) return displayName ?? name
  return `${displayName} (${name})`
})

const canEditDisplayName = computed(() =>
  isTeamLeader.value
  && userProfile.value?.teamId === props.teamId,
)

watch(
  team,
  (value) => {
    displayNameInput.value = value?.displayName ?? value?.name ?? ''
  },
  { immediate: true },
)

// Auto-redirect to final phase when game enters final state
watchEffect(() => {
  if (isFinal.value) {
    router.replace({ name: 'FinalPhase', params: { teamId: props.teamId } })
  }
})

const orderedChallenges = computed(() => {
  if (!team.value) return []
  const ordered = getOrderedChallenges(team.value)
  return ordered.map((ch, index) => {
    const result = challengeDocs.value?.find((d) => d.challengeId === ch.id)
      ?? { status: 'pending', score: 0 }
    const isCurrent = isActive.value && index === currentRound.value
    const isLocked = isPaused.value || (isActive.value && index > currentRound.value)
    return { ...ch, result, isCurrent, isLocked }
  })
})

const currentChallengeId = computed(() => getCurrentChallengeForTeam(team.value))

function statusBg(ch) {
  if (ch.isCurrent) return 'bg-amber-500/10 border-amber-400/50 ring-1 ring-amber-400/30'
  if (ch.result.status === 'completed') return 'bg-emerald-500/10 border-emerald-500/30'
  if (ch.result.status === 'failed') return 'bg-red-500/10 border-red-500/30'
  if (ch.isLocked) return 'bg-slate-800/30 border-slate-700/30 opacity-50'
  return 'bg-slate-700/30 border-slate-700/50'
}

async function saveDisplayName() {
  const next = displayNameInput.value.trim()
  if (!next) return
  savingDisplayName.value = true
  displayNameError.value = null
  try {
    await updateDoc(teamRef, { displayName: next })
    editingDisplayName.value = false
  } catch (error) {
    displayNameError.value = error?.message ?? "Impossible de modifier le nom d'affichage."
  } finally {
    savingDisplayName.value = false
  }
}

function cancelEditDisplayName() {
  displayNameInput.value = team.value?.displayName ?? team.value?.name ?? ''
  editingDisplayName.value = false
  displayNameError.value = null
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header (fixed to top) -->
    <div class="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 p-6">
      <div class="max-w-2xl mx-auto flex items-center gap-3">
        <button v-if="!isTeamLeader" @click="router.push('/')" class="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div class="flex-1">
          <h1 class="text-2xl font-bold">{{ teamLabel }}</h1>
          <p class="text-slate-400 text-sm">Tableau de bord</p>
        </div>
      </div>
    </div>

    <!-- Main content with top padding -->
    <div class="max-w-2xl mx-auto p-6 pt-28">
    <!-- Waiting banner -->
    <div v-if="isWaiting" class="bg-sky-500/10 border border-sky-500/30 rounded-2xl p-4 mb-4">
      <p class="font-semibold text-sky-300">En attente du démarrage du jeu...</p>
      <p class="text-slate-400 text-sm">Un administrateur doit démarrer la première manche.</p>
    </div>

    <!-- Paused banner -->
    <div v-if="isPaused" class="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 mb-4 flex items-center gap-3">
      <span class="text-2xl">⏸</span>
      <div>
        <p class="font-semibold text-amber-400">Jeu en pause</p>
        <p class="text-slate-400 text-sm">Attendez la reprise du jeu pour continuer.</p>
      </div>
    </div>

    <!-- Round progress timer -->
    <div v-if="isActive || isPaused" class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-slate-400">Manche</p>
          <p class="text-xl font-bold text-white">{{ currentRound + 1 }} <span class="text-sm text-slate-500">/ {{ totalRounds }}</span></p>
        </div>
        <div class="text-right">
          <p class="text-sm text-slate-400">Temps restant</p>
          <p class="text-xl font-mono font-bold text-amber-400 flex items-center gap-1.5">
            <Clock class="w-4 h-4" />
            {{ roundTimerDisplay }}
          </p>
        </div>
      </div>
    </div>

    <!-- Team display name editor -->
    <div
      v-if="canEditDisplayName"
      class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 mb-6"
    >
      <p class="text-xs uppercase tracking-wide text-slate-400 mb-2">Nom affiché de l'équipe</p>
      <form
        v-if="editingDisplayName"
        @submit.prevent="saveDisplayName"
        class="flex gap-2"
      >
        <input
          v-model="displayNameInput"
          required
          class="flex-1 bg-slate-900/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition-colors"
        />
        <button
          type="submit"
          :disabled="!displayNameInput.trim() || savingDisplayName"
          class="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          {{ savingDisplayName ? '…' : 'Enregistrer' }}
        </button>
        <button
          type="button"
          @click="cancelEditDisplayName"
          :disabled="savingDisplayName"
          class="bg-slate-700/60 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          Annuler
        </button>
      </form>
      <div v-else class="flex items-center justify-between gap-3">
        <p class="text-slate-200 text-sm truncate">{{ team?.displayName ?? team?.name }}</p>
        <button
          @click="editingDisplayName = true"
          class="bg-slate-700/60 hover:bg-slate-700 text-slate-200 font-semibold px-3 py-1.5 rounded-lg text-sm transition-colors"
        >
          Modifier
        </button>
      </div>
      <p v-if="displayNameError" class="text-sm text-red-400 mt-2">{{ displayNameError }}</p>
    </div>

    <!-- Score card -->
    <div class="bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-2xl p-6 mb-8">
      <div class="flex items-center gap-4">
        <div class="bg-amber-500/20 rounded-full p-3">
          <Trophy class="w-8 h-8 text-amber-400" />
        </div>
        <div>
          <p class="text-slate-300 text-sm font-medium">Score total</p>
          <p class="text-4xl font-extrabold text-amber-400">{{ team?.totalScore ?? 0 }}</p>
        </div>
      </div>
    </div>

    <!-- Challenge list -->
    <h2 class="text-lg font-semibold mb-4">Épreuves</h2>
    <div class="space-y-3">
      <component
        :is="ch.isLocked ? 'div' : 'router-link'"
        v-for="(ch, idx) in orderedChallenges"
        :key="ch.id"
        v-bind="ch.isLocked ? {} : { to: { name: 'ChallengeDetail', params: { teamId, challengeId: ch.id } } }"
        class="block rounded-xl border p-4 transition-all"
        :class="[statusBg(ch), ch.isLocked ? 'cursor-not-allowed' : 'hover:scale-[1.01]']"
      >
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs text-slate-500 font-mono w-5 text-right">{{ idx + 1 }}</span>
            <span class="text-3xl">{{ ch.icon }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold truncate">{{ ch.name }}</h3>
            <div class="flex items-center gap-2 mt-1">
              <!-- completed/failed always take priority over current/locked -->
              <span v-if="ch.result.status === 'completed'" class="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                ✓ Réussi
              </span>
              <span v-else-if="ch.result.status === 'failed'" class="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                ✗ Échoué
              </span>
              <span v-else-if="ch.isCurrent" class="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                ▶ En cours
              </span>
              <span v-else-if="ch.isLocked" class="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-600/30 text-slate-500">
                Verrouillé
              </span>
              <span v-else class="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-600/30 text-slate-400">
                En attente
              </span>
              <span v-if="ch.result.score > 0" class="text-amber-400 text-sm font-semibold">
                +{{ ch.result.score }} pts
              </span>
            </div>
          </div>
          <ChevronRight v-if="!ch.isLocked" class="w-5 h-5 text-slate-500" />
        </div>
      </component>
    </div>
    </div>
  </div>
</template>
