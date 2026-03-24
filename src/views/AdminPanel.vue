<script setup>
import { ref, computed } from 'vue'
import { collection, collectionGroup, doc, deleteDoc, getDocs, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useCollection, useCurrentUser } from 'vuefire'
import { useRouter } from 'vue-router'
import { db, functions } from '../firebase'
import { useAuth } from '../composables/useAuth'
import { useGameState } from '../composables/useGameState'
import {
  Shield, ArrowLeft, Users, LogOut, UserCog,
  Play, SkipForward, Square, RotateCcw, Clock, Pause, PlayCircle, Trash2, ChevronsRight,
} from 'lucide-vue-next'

const router = useRouter()
const user = useCurrentUser()
const { signOut } = useAuth()
const teams = useCollection(collection(db, 'teams'))
const users = useCollection(collection(db, 'users'))
const allChallengeDocs = useCollection(collectionGroup(db, 'challenges'))
const { isWaiting, isActive, isPaused, isFinal, isFinished, currentRound, totalRounds, roundDurationMinutes, roundTimerDisplay, finalTimerDisplay } = useGameState()

// Round duration setting (for Start Game)
const roundDurationInput = ref(15)

const actionLoading = ref(false)
const deletingTeamId = ref(null)
const confirmDeleteId = ref(null)

const rankedTeams = computed(() => {
  if (!teams.value) return []
  return [...teams.value].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
})

function leaderName(team) {
  if (!team.leaderUid || !users.value) return null
  return users.value.find((u) => u.id === team.leaderUid)?.displayName ?? null
}

function formatTeamName(team) {
  const displayName = team?.displayName
  const name = team?.name
  if (!displayName && !name) return '—'
  if (!displayName || !name) return displayName ?? name
  return `${displayName} (${name})`
}

// For each team, find the challenge ID at currentRound in their challengeOrder,
// then check challenge docs from the collectionGroup.
const currentChallengeCompletions = computed(() => {
  if (!teams.value || !allChallengeDocs.value || (!isActive.value && !isPaused.value)) return null
  let completed = 0
  let attempted = 0
  let counted = 0
  for (const team of teams.value) {
    const order = team.challengeOrder
    if (!Array.isArray(order) || order.length === 0) {
      // challengeOrder not set yet — skip this team from denominator too
      continue
    }
    counted++
    const challengeId = order[currentRound.value]
    if (!challengeId) continue
    const doc = allChallengeDocs.value.find(
      (d) => d.challengeId === challengeId && d.teamId === team.id
    )
    if (doc?.status === 'completed') { completed++; attempted++ }
    else if (doc?.status === 'failed') { attempted++ }
  }
  if (counted === 0) return null
  return { completed, attempted, total: counted }
})

async function callFn(name, data) {
  actionLoading.value = true
  try {
    await httpsCallable(functions, name)(data ?? {})
  } catch (e) {
    console.error(`Failed to call ${name}:`, e)
  } finally {
    actionLoading.value = false
  }
}

async function handleJumpToStep(step) {
  await callFn('jumpToStep', { step })
}

async function handleDeleteTeam(team) {
  if (confirmDeleteId.value !== team.id) {
    confirmDeleteId.value = team.id
    return
  }
  confirmDeleteId.value = null
  deletingTeamId.value = team.id
  try {
    // Delete challenges subcollection first
    const challengesSnap = await getDocs(collection(db, 'teams', team.id, 'challenges'))
    await Promise.all(challengesSnap.docs.map((d) => deleteDoc(d.ref)))
    await deleteDoc(doc(db, 'teams', team.id))
  } finally {
    deletingTeamId.value = null
  }
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header (fixed to top) -->
    <div class="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 p-6">
      <div class="max-w-3xl mx-auto flex items-center gap-3">
        <button @click="router.push('/')" class="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div class="flex-1">
          <h1 class="text-2xl font-bold flex items-center gap-2">
            <Shield class="w-6 h-6 text-amber-400" />
            Panneau Admin
          </h1>
          <p class="text-slate-400 text-sm">Classement &amp; vue d'ensemble</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-slate-400 text-sm hidden sm:block">{{ user?.displayName }}</span>
          <router-link
            :to="{ name: 'AdminUsers' }"
            class="flex items-center gap-2 text-slate-400 hover:text-amber-400 bg-slate-700/50 hover:bg-slate-700 px-3 py-2 rounded-xl transition-colors"
            title="Gérer les utilisateurs"
          >
            <UserCog class="w-5 h-5" />
            <span class="text-sm font-medium">Utilisateurs</span>
          </router-link>
          <button @click="async () => { await signOut(); router.push({ name: 'Login' }) }" class="text-slate-500 hover:text-white transition-colors" title="Se déconnecter">
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Main content with top padding -->
    <div class="max-w-3xl mx-auto p-6 pt-28">

    <!-- Leaderboard -->
    <div class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 mb-8">
      <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
        <Trophy class="w-5 h-5 text-amber-400" />
        Classement
      </h2>
      <div class="space-y-2">
        <div
          v-for="(team, idx) in rankedTeams"
          :key="team.id"
          class="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors cursor-pointer hover:bg-slate-700/40"
          :class="idx === 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-900/30'"
          @click="router.push({ name: 'AdminTeamDetail', params: { teamId: team.id } })"
        >
          <!-- Rank -->
          <span
            class="text-sm font-bold w-6 text-center shrink-0"
            :class="idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-700' : 'text-slate-500'"
          >
            {{ idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1 }}
          </span>

          <!-- Team name -->
          <div class="flex-1 min-w-0">
            <p class="font-semibold truncate">{{ formatTeamName(team) }}</p>
            <p v-if="leaderName(team)" class="text-xs text-slate-500 truncate">{{ leaderName(team) }}</p>
          </div>

          <!-- Challenge progress -->
          <div class="text-xs text-slate-500 text-center hidden sm:block shrink-0">
            <span class="font-medium text-slate-300">{{ team.challengeOrder?.length ? Math.min(currentRound + 1, team.challengeOrder.length) : '—' }}</span>
            <span> / {{ team.challengeOrder?.length ?? '?' }}</span>
          </div>

          <!-- Score -->
          <span
            class="font-bold text-lg shrink-0 tabular-nums"
            :class="idx === 0 ? 'text-amber-400' : 'text-slate-200'"
          >
            {{ (team.totalScore ?? 0).toLocaleString() }} pts
          </span>
        </div>
        <p v-if="!rankedTeams.length" class="text-slate-500 text-sm text-center py-4">Aucune équipe enregistrée.</p>
      </div>
    </div>

    <!-- Game Controls -->
    <div class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 mb-8">
      <h2 class="text-lg font-semibold mb-4">Contrôle du jeu</h2>

      <!-- Waiting state -->
      <div v-if="isWaiting" class="space-y-3">
        <p class="text-slate-400 text-sm">Le jeu n'a pas encore démarré. Les équipes attendent.</p>
        <div class="flex items-center gap-3">
          <label class="text-xs text-slate-400 shrink-0">Durée d'une manche (min)</label>
          <input
            v-model.number="roundDurationInput"
            type="number" min="1" max="60"
            class="w-24 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/60 transition-colors"
          />
          <span class="text-xs text-slate-500">→ minuteur global {{ Math.round(roundDurationInput * 1.2) }} min</span>
        </div>
        <button
          @click="callFn('startGame', { roundDurationMinutes: roundDurationInput })"
          :disabled="actionLoading || !teams || teams.length === 0"
          class="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
        >
          <Play class="w-5 h-5" />
          {{ actionLoading ? 'Démarrage...' : 'Démarrer le jeu' }}
        </button>
      </div>

      <!-- Active or Paused state -->
      <div v-else-if="isActive || isPaused" class="space-y-4">
        <!-- Round / Timer row -->
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-slate-400">Étape en cours</p>
            <p class="text-2xl font-bold text-amber-400">
              {{ currentRound + 1 }}
              <span class="text-base text-slate-500">/ {{ totalRounds }}</span>
            </p>
            <p class="text-xs text-slate-500 mt-0.5">Manches de {{ roundDurationMinutes }} min</p>
          </div>
          <div class="text-right">
            <p class="text-sm text-slate-400">Minuteur de manche</p>
            <p class="text-2xl font-mono font-bold flex items-center gap-2"
               :class="isPaused ? 'text-slate-400' : 'text-amber-400'">
              <Clock class="w-5 h-5" />
              {{ roundTimerDisplay }}
            </p>
          </div>
        </div>

        <!-- Completion counter -->
        <div v-if="currentChallengeCompletions" class="bg-slate-900/40 rounded-xl px-4 py-3 space-y-2">
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-700/60 rounded-full h-2">
              <div
                class="h-2 rounded-full transition-all duration-500 bg-emerald-500"
                :style="{ width: currentChallengeCompletions.total > 0 ? `${(currentChallengeCompletions.completed / currentChallengeCompletions.total) * 100}%` : '0%' }"
              ></div>
            </div>
            <span class="text-sm font-bold shrink-0 text-emerald-400 w-12 text-right">
              {{ currentChallengeCompletions.completed }}/{{ currentChallengeCompletions.total }} ✓
            </span>
          </div>
          <div v-if="currentChallengeCompletions.attempted > currentChallengeCompletions.completed" class="flex items-center gap-2">
            <div class="flex-1 bg-slate-700/60 rounded-full h-2">
              <div
                class="h-2 rounded-full transition-all duration-500 bg-red-500"
                :style="{ width: currentChallengeCompletions.total > 0 ? `${((currentChallengeCompletions.attempted - currentChallengeCompletions.completed) / currentChallengeCompletions.total) * 100}%` : '0%' }"
              ></div>
            </div>
            <span class="text-sm font-bold shrink-0 text-red-400 w-12 text-right">
              {{ currentChallengeCompletions.attempted - currentChallengeCompletions.completed }}/{{ currentChallengeCompletions.total }} ✗
            </span>
          </div>
        </div>

        <!-- Step progress dots -->
        <div class="flex gap-1.5 flex-wrap">
          <button
            v-for="i in totalRounds"
            :key="i"
            @click="handleJumpToStep(i - 1)"
            :disabled="actionLoading"
            :title="`Aller à l'étape ${i}`"
            class="w-7 h-7 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed"
            :class="i - 1 < currentRound
              ? 'bg-emerald-500/30 text-emerald-400 hover:bg-emerald-500/50'
              : i - 1 === currentRound
                ? 'bg-amber-500 text-slate-900 scale-110 shadow-lg shadow-amber-500/30'
                : 'bg-slate-700/50 text-slate-500 hover:bg-slate-600/50'"
          >
            {{ i }}
          </button>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3">
          <!-- Pause / Resume -->
          <button
            v-if="isActive"
            @click="callFn('pauseGame')"
            :disabled="actionLoading"
            class="flex items-center justify-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-40"
          >
            <Pause class="w-4 h-4" />
            Pause
          </button>
          <button
            v-else
            @click="callFn('resumeGame')"
            :disabled="actionLoading"
            class="flex items-center justify-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-40"
          >
            <PlayCircle class="w-4 h-4" />
            Reprendre
          </button>

          <!-- Next round -->
          <button
            @click="callFn('advanceRound')"
            :disabled="actionLoading"
            class="flex-1 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            <SkipForward class="w-5 h-5" />
            {{ actionLoading ? '...' : 'Étape suivante' }}
          </button>

          <!-- End game -->
          <button
            @click="callFn('endGame')"
            :disabled="actionLoading"
            class="flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-40"
          >
            <Square class="w-4 h-4" />
            Terminer
          </button>
        </div>
      </div>

      <!-- Final phase state -->
      <div v-else-if="isFinal" class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-slate-400">Phase Finale</p>
            <p class="text-emerald-400 font-semibold">En cours</p>
          </div>
          <div class="text-right">
            <p class="text-sm text-slate-400">Temps restant</p>
            <p class="text-2xl font-mono font-bold text-amber-400 flex items-center gap-2">
              <Clock class="w-5 h-5" />
              {{ finalTimerDisplay }}
            </p>
          </div>
        </div>

        <!-- Guess tracker -->
        <div class="space-y-2">
          <p class="text-xs text-slate-400">Équipes ayant deviné</p>
          <div v-for="team in rankedTeams" :key="team.id" class="flex items-center gap-3 bg-slate-900/40 rounded-lg px-3 py-2">
            <span class="flex-1 text-sm font-medium truncate">{{ formatTeamName(team) }}</span>
            <span v-if="team.hasGuessed && team.guessCorrect" class="text-xs text-emerald-400 font-semibold">✓ Correct +5000</span>
            <span v-else-if="team.hasGuessed" class="text-xs text-red-400">✗ {{ team.guess }}</span>
            <span v-else class="text-xs text-slate-500 italic">En attente…</span>
          </div>
        </div>

        <!-- End final / reset -->
        <div class="flex gap-3">
          <button
            @click="callFn('endGame')"
            :disabled="actionLoading"
            class="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
          >
            <Square class="w-4 h-4" />
            Terminer
          </button>
        </div>
      </div>

      <!-- Finished state -->
      <div v-else-if="isFinished" class="space-y-3">
        <p class="text-emerald-400 font-semibold">Jeu terminé !</p>
        <button
          @click="callFn('resetGame')"
          :disabled="actionLoading"
          class="w-full flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          <RotateCcw class="w-5 h-5" />
          {{ actionLoading ? '...' : 'Réinitialiser' }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="!teams" class="text-center text-slate-400 py-12">Chargement des équipes...</div>

    <!-- Empty -->
    <div v-else-if="teams.length === 0" class="text-center py-12">
      <Users class="w-12 h-12 mx-auto text-slate-600 mb-3" />
      <p class="text-slate-400">Aucune équipe enregistrée.</p>
    </div>

    <!-- Rankings -->
    <div v-else class="space-y-3">
      <h2 class="text-lg font-semibold mb-2">Classement des équipes</h2>
      <div
        v-for="(team, index) in rankedTeams"
        :key="team.id"
        class="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 transition-all"
        :class="confirmDeleteId === team.id ? 'border-red-500/40' : 'hover:border-slate-600'"
      >
        <div class="flex items-center gap-4">
          <!-- Rank badge -->
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
            :class="{
              'bg-amber-500/20 text-amber-400': index === 0,
              'bg-slate-500/20 text-slate-300': index === 1,
              'bg-orange-800/20 text-orange-400': index === 2,
              'bg-slate-700/30 text-slate-500': index > 2,
            }"
          >
            {{ index + 1 }}
          </div>

          <!-- Team info -->
          <div class="flex-1 min-w-0">
            <router-link
              :to="{ name: 'AdminTeamDetail', params: { teamId: team.id } }"
              class="font-semibold text-lg truncate hover:text-amber-400 transition-colors block"
            >
              {{ formatTeamName(team) }}
            </router-link>
            <p class="text-slate-400 text-sm truncate">
              <span v-if="leaderName(team)" class="text-sky-400">{{ leaderName(team) }}</span>
              <span v-else class="italic">Aucun chef d'équipe</span>
            </p>
          </div>

          <!-- Score -->
          <div class="text-right shrink-0">
            <p class="text-2xl font-extrabold text-amber-400">{{ team.totalScore ?? 0 }}</p>
            <p class="text-slate-500 text-xs">points</p>
          </div>

          <!-- Delete -->
          <button
            @click.stop="handleDeleteTeam(team)"
            :disabled="deletingTeamId === team.id"
            class="shrink-0 p-2 rounded-lg transition-colors disabled:opacity-40"
            :class="confirmDeleteId === team.id
              ? 'bg-red-500 text-white'
              : 'text-slate-600 hover:text-red-400 hover:bg-red-500/10'"
            :title="confirmDeleteId === team.id ? 'Cliquez à nouveau pour confirmer' : 'Supprimer l\'équipe'"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>

        <!-- Confirm delete hint -->
        <p v-if="confirmDeleteId === team.id" class="mt-2 text-xs text-red-400 text-right">
          Cliquez à nouveau sur la corbeille pour confirmer
        </p>
      </div>
    </div>
    </div>
  </div>
</template>
