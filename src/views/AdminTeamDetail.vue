<script setup>
import { computed } from 'vue'
import { doc, collection } from 'firebase/firestore'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { ArrowLeft, Trophy, Clock, Target, CheckCircle, XCircle } from 'lucide-vue-next'

const props = defineProps({
  teamId: String,
})

const router = useRouter()
const team = useDocument(doc(db, 'teams', props.teamId))
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))

const challengeDetails = computed(() => {
  return CHALLENGES.map((ch) => {
    const result = challengeDocs.value?.find((d) => d.challengeId === ch.id)
      ?? { status: 'pending', score: 0, factors: {} }
    return { ...ch, result }
  })
})

function formatTime(seconds) {
  if (seconds == null) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}
</script>

<template>
  <div class="max-w-3xl mx-auto p-6">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <button @click="router.push({ name: 'AdminPanel' })" class="text-slate-400 hover:text-white transition-colors">
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="flex-1">
        <h1 class="text-2xl font-bold">{{ team?.name ?? 'Loading...' }}</h1>
        <p class="text-slate-400 text-sm">Team Detail — Admin View</p>
      </div>
      <div class="text-right">
        <div class="flex items-center gap-2">
          <Trophy class="w-5 h-5 text-amber-400" />
          <span class="text-2xl font-extrabold text-amber-400">{{ team?.totalScore ?? 0 }}</span>
        </div>
        <p class="text-slate-500 text-xs">total points</p>
      </div>
    </div>

    <!-- Challenge breakdown -->
    <div class="space-y-4">
      <div
        v-for="ch in challengeDetails"
        :key="ch.id"
        class="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden"
      >
        <!-- Challenge header -->
        <div class="flex items-center gap-3 p-4 border-b border-slate-700/30">
          <span class="text-2xl">{{ ch.icon }}</span>
          <div class="flex-1">
            <h3 class="font-semibold">{{ ch.name }}</h3>
          </div>
          <span
            class="text-xs font-medium px-2.5 py-1 rounded-full"
            :class="{
              'bg-emerald-500/20 text-emerald-400': ch.result.status === 'completed',
              'bg-amber-500/20 text-amber-400': ch.result.status === 'in_progress',
              'bg-red-500/20 text-red-400': ch.result.status === 'failed',
              'bg-slate-600/30 text-slate-400': ch.result.status === 'pending',
            }"
          >
            {{ ch.result.status === 'in_progress' ? 'In Progress' : ch.result.status }}
          </span>
          <span class="font-bold text-lg" :class="ch.result.score > 0 ? 'text-amber-400' : 'text-slate-600'">
            {{ ch.result.score ?? 0 }} pts
          </span>
        </div>

        <!-- Factors -->
        <div
          v-if="ch.result.status !== 'pending'"
          class="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm"
        >
          <div class="flex items-center gap-2">
            <Clock class="w-4 h-4 text-slate-400" />
            <span class="text-slate-400">Time Spent:</span>
            <span class="text-white font-medium">{{ formatTime(ch.result.factors?.timeSpent) }}</span>
          </div>
          <div v-if="ch.factors.includes('targetsHit')" class="flex items-center gap-2">
            <Target class="w-4 h-4 text-slate-400" />
            <span class="text-slate-400">Targets:</span>
            <span class="text-white font-medium">{{ ch.result.factors?.targetsHit ?? '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <component :is="ch.result.status === 'completed' ? CheckCircle : XCircle"
              class="w-4 h-4"
              :class="ch.result.status === 'completed' ? 'text-emerald-400' : 'text-red-400'"
            />
            <span class="text-slate-400">Result:</span>
            <span
              class="font-medium"
              :class="ch.result.status === 'completed' ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ ch.result.status === 'completed' ? 'Success' : ch.result.status === 'failed' ? 'Failed' : '—' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
