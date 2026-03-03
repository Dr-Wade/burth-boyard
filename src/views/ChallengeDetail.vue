<script setup>
import { ref, computed, onUnmounted, watch } from 'vue'
import { doc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db, functions } from '../firebase'
import { getChallengeById } from '../data/challenges'
import { ArrowLeft, Play, Square, Target, XCircle } from 'lucide-vue-next'

const props = defineProps({
  teamId: String,
  challengeId: String,
})

const router = useRouter()
const challenge = getChallengeById(props.challengeId)
const teamRef = doc(db, 'teams', props.teamId)
const team = useDocument(teamRef)
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))

const timerDisplay = ref('10:00')
const elapsedSeconds = ref(0)
const timerInterval = ref(null)
const isRunning = ref(false)
const targetsHit = ref(0)

const hasMultipleFactors = computed(() => challenge?.factors?.includes('targetsHit'))

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
  if (snap.empty) throw new Error('Challenge doc not found in subcollection')
  return snap.docs[0].ref
}

// Restore timer if already in progress
watch(challengeResult, (result) => {
  if (!result) return
  if (result.status === 'in_progress' && result.startedAt && !isRunning.value) {
    const startTime = result.startedAt.toDate ? result.startedAt.toDate() : new Date(result.startedAt)
    const now = new Date()
    const diffSec = Math.floor((now - startTime) / 1000)
    if (diffSec < challenge.maxTimeSeconds) {
      elapsedSeconds.value = diffSec
      startCountdown(startTime)
    }
  }
}, { immediate: true })

function startCountdown(startTime) {
  isRunning.value = true
  timerInterval.value = setInterval(() => {
    const now = new Date()
    const diffSec = Math.floor((now - startTime) / 1000)
    elapsedSeconds.value = diffSec
    const remaining = Math.max(0, challenge.maxTimeSeconds - diffSec)
    const mins = Math.floor(remaining / 60)
    const secs = remaining % 60
    timerDisplay.value = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

    if (remaining <= 0) {
      clearInterval(timerInterval.value)
      isRunning.value = false
      markFailed()
    }
  }, 250)
}

async function startChallenge() {
  const now = new Date()
  const ref = await getChallengeDocRef()
  await updateDoc(ref, { status: 'in_progress', startedAt: now })
  startCountdown(now)
}

async function completeChallenge() {
  clearInterval(timerInterval.value)
  isRunning.value = false

  const factors = { timeSpent: elapsedSeconds.value }
  if (hasMultipleFactors.value) factors.targetsHit = targetsHit.value

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
  }
}

async function markFailed() {
  clearInterval(timerInterval.value)
  isRunning.value = false
  const ref = await getChallengeDocRef()
  await updateDoc(ref, {
    status: 'failed',
    failed: true,
    score: 0,
    completedAt: new Date(),
    factors: { timeSpent: elapsedSeconds.value },
  })
}

const timerColor = computed(() => {
  const remaining = challenge.maxTimeSeconds - elapsedSeconds.value
  if (remaining <= 60) return 'text-red-400'
  if (remaining <= 180) return 'text-amber-400'
  return 'text-emerald-400'
})

onUnmounted(() => {
  if (timerInterval.value) clearInterval(timerInterval.value)
})
</script>

<template>
  <div class="max-w-lg mx-auto p-6">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <button
        @click="router.push({ name: 'TeamDashboard', params: { teamId } })"
        class="text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div>
        <h1 class="text-2xl font-bold">{{ challenge?.icon }} {{ challenge?.name }}</h1>
        <p class="text-slate-400 text-sm">{{ team?.name }}</p>
      </div>
    </div>

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

    <!-- Timer -->
    <div class="text-center mb-8">
      <p
        class="text-7xl font-mono font-bold tabular-nums transition-colors"
        :class="isRunning ? timerColor : 'text-slate-500'"
      >
        {{ timerDisplay }}
      </p>
      <p class="text-slate-500 text-sm mt-2">
        {{ isRunning ? 'Time remaining' : isCompleted ? 'Challenge ended' : 'Ready to start' }}
      </p>
    </div>

    <!-- Targets input (if applicable) -->
    <div v-if="hasMultipleFactors && isRunning" class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 mb-6">
      <label class="flex items-center gap-2 text-sm font-medium text-slate-300 mb-3">
        <Target class="w-4 h-4 text-amber-400" />
        Targets Hit
      </label>
      <div class="flex items-center gap-3">
        <button
          @click="targetsHit = Math.max(0, targetsHit - 1)"
          class="bg-slate-700 hover:bg-slate-600 w-10 h-10 rounded-xl text-lg font-bold transition-colors"
        >
          −
        </button>
        <span class="text-3xl font-bold tabular-nums w-16 text-center">{{ targetsHit }}</span>
        <button
          @click="targetsHit++"
          class="bg-slate-700 hover:bg-slate-600 w-10 h-10 rounded-xl text-lg font-bold transition-colors"
        >
          +
        </button>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="!isCompleted" class="flex gap-3">
      <button
        v-if="!isRunning"
        @click="startChallenge"
        class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
      >
        <Play class="w-5 h-5" />
        Start Challenge
      </button>

      <template v-if="isRunning">
        <button
          @click="completeChallenge"
          class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          <Square class="w-5 h-5" />
          Complete
        </button>
        <button
          @click="markFailed"
          class="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold px-6 py-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-red-500/30"
        >
          <XCircle class="w-5 h-5" />
          Fail
        </button>
      </template>
    </div>

    <!-- Result display -->
    <div v-if="isCompleted" class="text-center">
      <div
        v-if="challengeResult?.status === 'completed'"
        class="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6"
      >
        <p class="text-emerald-400 font-semibold text-lg mb-1">Challenge Complete!</p>
        <p class="text-4xl font-extrabold text-emerald-400">+{{ challengeResult.score }} pts</p>
      </div>
      <div
        v-else
        class="bg-red-500/10 border border-red-500/30 rounded-2xl p-6"
      >
        <p class="text-red-400 font-semibold text-lg mb-1">Challenge Failed</p>
        <p class="text-slate-400">No points awarded</p>
      </div>
    </div>
  </div>
</template>
