<script setup>
import { computed, ref } from 'vue'
import { doc, collection, updateDoc, runTransaction } from 'firebase/firestore'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { useGameState } from '../composables/useGameState'
import { ArrowLeft, Trophy, Clock, Target, CheckCircle, XCircle, Pencil, Save, X, Swords, Lightbulb, KeyRound, ShoppingCart } from 'lucide-vue-next'

const props = defineProps({
  teamId: String,
})

const router = useRouter()
const teamRef = doc(db, 'teams', props.teamId)
const team = useDocument(teamRef)
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))
const { isActive, isPaused, currentRound, getCurrentChallengeForTeam } = useGameState()

const currentChallengeId = computed(() => getCurrentChallengeForTeam(team.value))

const challengeDetails = computed(() => {
  if (!team.value?.challengeOrder?.length) {
    return CHALLENGES.map((ch) => {
      const result = challengeDocs.value?.find((d) => d.challengeId === ch.id)
        ?? { status: 'pending', score: 0, factors: {} }
      return { ...ch, result, isCurrent: false }
    })
  }
  return team.value.challengeOrder.map((id, index) => {
    const ch = CHALLENGES.find((c) => c.id === id)
    if (!ch) return null
    const result = challengeDocs.value?.find((d) => d.challengeId === id)
      ?? { status: 'pending', score: 0, factors: {} }
    const isCurrent = (isActive.value || isPaused.value) && index === currentRound.value
    return { ...ch, result, isCurrent }
  }).filter(Boolean)
})

const teamLabel = computed(() => {
  const displayName = team.value?.displayName
  const name = team.value?.name
  if (!displayName && !name) return 'Loading...'
  if (!displayName || !name) return displayName ?? name
  return `${displayName} (${name})`
})

function formatTime(seconds) {
  if (seconds == null) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

// ── Inline editing ──
const editingId = ref(null)
const editStatus = ref('pending')
const editScore = ref(0)
const saving = ref(false)
const editError = ref(null)

const STATUSES = [
  { value: 'pending', label: 'En attente', cls: 'bg-slate-600/30 text-slate-400 border-slate-600/30' },
  { value: 'in_progress', label: 'En cours', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'completed', label: 'Réussi', cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'failed', label: 'Échoué', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
]

function startEdit(ch) {
  editingId.value = ch.id
  editStatus.value = ch.result.status ?? 'pending'
  editScore.value = ch.result.score ?? 0
  editError.value = null
}

function cancelEdit() {
  editingId.value = null
  editError.value = null
}

async function saveEdit(ch) {
  saving.value = true
  editError.value = null
  try {
    const challengeDocData = challengeDocs.value?.find((d) => d.challengeId === ch.id)
    const challengeDocId = challengeDocData?.id ?? ch.id
    const nextScore = Number(editScore.value)

    if (Number.isNaN(nextScore)) {
      throw new Error('Le score doit être un nombre.')
    }

    const docRef = doc(db, 'teams', props.teamId, 'challenges', challengeDocId)
    const prevScore = Number(challengeDocData?.score ?? 0)
    const scoreDiff = nextScore - prevScore

    await runTransaction(db, async (tx) => {
      const teamSnap = await tx.get(teamRef)
      if (!teamSnap.exists()) {
        throw new Error('Équipe introuvable.')
      }

      tx.set(docRef, {
        teamId: props.teamId,
        challengeId: ch.id,
        status: editStatus.value,
        score: nextScore,
        failed: editStatus.value === 'failed',
      }, { merge: true })
      tx.update(teamRef, {
        totalScore: (teamSnap.data().totalScore ?? 0) + scoreDiff,
      })
    })

    editingId.value = null
  } catch (e) {
    editError.value = e?.message ?? "Impossible d'enregistrer la modification."
    console.error('Failed to save challenge edit:', e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header (fixed to top) -->
    <div class="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 p-6">
      <div class="max-w-3xl mx-auto flex items-center gap-3">
        <button @click="router.push({ name: 'AdminPanel' })" class="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div class="flex-1">
          <h1 class="text-2xl font-bold">{{ teamLabel }}</h1>
          <p class="text-slate-400 text-sm">Détail de l'équipe — Vue admin</p>
        </div>
        <div class="text-right">
          <div class="flex items-center gap-2">
            <Trophy class="w-5 h-5 text-amber-400" />
            <span class="text-2xl font-extrabold text-amber-400">{{ team?.totalScore ?? 0 }}</span>
          </div>
          <p class="text-slate-500 text-xs">points au total</p>
        </div>
      </div>
    </div>

    <!-- Main content with top padding -->
    <div class="max-w-3xl mx-auto p-6 pt-28">

    <!-- Current challenge banner -->
    <div v-if="currentChallengeId" class="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6 flex items-center gap-3">
      <Swords class="w-6 h-6 text-amber-400 shrink-0" />
      <div>
        <p class="text-sm text-slate-400">Épreuve en cours</p>
        <p class="font-semibold text-amber-400">
          {{ CHALLENGES.find(c => c.id === currentChallengeId)?.icon }}
          {{ CHALLENGES.find(c => c.id === currentChallengeId)?.name }}
        </p>
      </div>
    </div>

    <!-- Challenge breakdown -->
    <div class="space-y-4">
      <div
        v-for="(ch, idx) in challengeDetails"
        :key="ch.id"
        class="rounded-xl overflow-hidden transition-all"
        :class="ch.isCurrent
          ? 'bg-amber-500/10 border-2 border-amber-400/50 ring-1 ring-amber-400/20'
          : 'bg-slate-800/60 border border-slate-700/50'"
      >
        <!-- Challenge header -->
        <div class="flex items-center gap-3 p-4 border-b border-slate-700/30">
          <span class="text-xs text-slate-500 font-mono w-5 text-right">{{ idx + 1 }}</span>
          <span class="text-2xl">{{ ch.icon }}</span>
          <div class="flex-1">
            <h3 class="font-semibold">
              {{ ch.name }}
              <span v-if="ch.isCurrent" class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">▶ En cours</span>
            </h3>
          </div>
          <span
            v-if="editingId !== ch.id"
            class="text-xs font-medium px-2.5 py-1 rounded-full"
            :class="{
              'bg-emerald-500/20 text-emerald-400': ch.result.status === 'completed',
              'bg-amber-500/20 text-amber-400': ch.result.status === 'in_progress',
              'bg-red-500/20 text-red-400': ch.result.status === 'failed',
              'bg-slate-600/30 text-slate-400': ch.result.status === 'pending',
            }"
          >
            {{ ch.result.status === 'in_progress' ? 'En cours' : ch.result.status === 'completed' ? 'Réussi' : ch.result.status === 'failed' ? 'Échoué' : 'En attente' }}
          </span>
          <span v-if="editingId !== ch.id" class="font-bold text-lg" :class="ch.result.score > 0 ? 'text-amber-400' : ch.result.score < 0 ? 'text-red-400' : 'text-slate-600'">
            {{ ch.result.score ?? 0 }} pts
          </span>
          <button
            v-if="editingId !== ch.id"
            @click="startEdit(ch)"
            class="shrink-0 p-2 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            title="Modifier"
          >
            <Pencil class="w-4 h-4" />
          </button>
        </div>

        <!-- Edit form -->
        <div v-if="editingId === ch.id" class="px-4 py-3 space-y-3 bg-slate-900/30">
          <div class="space-y-1">
            <label class="text-xs text-slate-400">Statut</label>
            <div class="flex gap-2 flex-wrap">
              <button
                v-for="s in STATUSES"
                :key="s.value"
                type="button"
                @click="editStatus = s.value"
                class="text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium"
                :class="editStatus === s.value ? s.cls + ' ring-1 ring-current' : 'bg-slate-700/40 border-slate-600/50 text-slate-400 hover:bg-slate-700/70'"
              >
                {{ s.label }}
              </button>
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-xs text-slate-400">Score (points)</label>
            <input
              v-model.number="editScore"
              type="number"
              class="w-32 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/60 transition-colors"
            />
          </div>
          <p v-if="editError" class="text-sm text-red-400">{{ editError }}</p>
          <div class="flex items-center gap-2">
            <button
              @click="saveEdit(ch)"
              :disabled="saving || Number.isNaN(Number(editScore))"
              class="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              <Save class="w-3.5 h-3.5" />
              {{ saving ? '…' : 'Enregistrer' }}
            </button>
            <button
              @click="cancelEdit"
              :disabled="saving"
              class="flex items-center gap-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              <X class="w-3.5 h-3.5" />
              Annuler
            </button>
          </div>
        </div>

        <!-- Factors (read-only, shown when not editing) -->
        <div
          v-if="ch.result.status !== 'pending' && editingId !== ch.id"
          class="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm"
        >
          <div class="flex items-center gap-2">
            <Clock class="w-4 h-4 text-slate-400" />
            <span class="text-slate-400">Temps :</span>
            <span class="text-white font-medium">{{ formatTime(ch.result.factors?.timeSpent) }}</span>
          </div>
          <div v-if="ch.factors.includes('targetsHit')" class="flex items-center gap-2">
            <Target class="w-4 h-4 text-slate-400" />
            <span class="text-slate-400">Cibles :</span>
            <span class="text-white font-medium">{{ ch.result.factors?.targetsHit ?? '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <component :is="ch.result.status === 'completed' ? CheckCircle : XCircle"
              class="w-4 h-4"
              :class="ch.result.status === 'completed' ? 'text-emerald-400' : 'text-red-400'"
            />
            <span class="text-slate-400">Résultat :</span>
            <span
              class="font-medium"
              :class="ch.result.status === 'completed' ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ ch.result.status === 'completed' ? 'Réussi' : ch.result.status === 'failed' ? 'Échoué' : '—' }}
            </span>
          </div>
          <div v-if="ch.result.timedOut" class="flex items-center gap-2 col-span-full">
            <span class="text-xs text-red-400/70">⏱ Temps écoulé (−500 pts)</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Final phase section -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>🏯</span> Phase Finale
      </h2>
      <div class="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">

        <!-- Hints row -->
        <div class="grid grid-cols-2 divide-x divide-slate-700/40 border-b border-slate-700/40">
          <div class="p-4">
            <p class="text-xs text-slate-500 mb-1 flex items-center gap-1.5"><Lightbulb class="w-3.5 h-3.5" /> Indices gratuits</p>
            <p class="text-2xl font-bold text-amber-400">{{ Math.min(Math.floor((challengeDocs?.filter(d => d.status === 'completed').length ?? 0) / 2), (team?.finalHints?.length ?? 0)) }}</p>
            <p class="text-xs text-slate-500 mt-0.5">sur {{ team?.finalHints?.length ?? '?' }} disponibles</p>
          </div>
          <div class="p-4">
            <p class="text-xs text-slate-500 mb-1 flex items-center gap-1.5"><ShoppingCart class="w-3.5 h-3.5" /> Indices achetés</p>
            <p class="text-2xl font-bold" :class="(team?.boughtHints ?? 0) > 0 ? 'text-sky-400' : 'text-slate-500'">{{ team?.boughtHints ?? 0 }}</p>
            <p class="text-xs text-slate-500 mt-0.5">−{{ (team?.boughtHints ?? 0) * 3000 }} pts dépensés</p>
          </div>
        </div>

        <!-- Guess row -->
        <div class="p-4">
          <p class="text-xs text-slate-500 mb-3 flex items-center gap-1.5"><KeyRound class="w-3.5 h-3.5" /> Tentative de devinette</p>

          <!-- Not guessed yet -->
          <div v-if="!team?.hasGuessed" class="flex items-center gap-2 text-slate-400">
            <XCircle class="w-4 h-4" />
            <span class="text-sm italic">Aucune réponse soumise</span>
          </div>

          <!-- Guessed -->
          <div v-else class="space-y-3">
            <div class="flex items-center gap-3">
              <span
                class="text-xs font-semibold px-2.5 py-1 rounded-full"
                :class="team?.guessCorrect ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'"
              >
                {{ team?.guessCorrect ? '✓ Correct' : '✗ Incorrect' }}
              </span>
              <span class="font-semibold text-white">« {{ team?.guess }} »</span>
            </div>
            <div class="flex items-center gap-2">
              <Trophy class="w-4 h-4 text-amber-400" />
              <span class="text-slate-400 text-sm">Points gagnés :</span>
              <span
                class="font-bold text-lg"
                :class="team?.guessCorrect ? 'text-amber-400' : 'text-slate-500'"
              >
                {{ team?.guessCorrect ? '+10 000' : '+0' }} pts
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    </div>
  </div>
</template>
