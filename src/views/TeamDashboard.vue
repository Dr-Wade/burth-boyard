<script setup>
import { computed } from 'vue'
import { doc, collection } from 'firebase/firestore'
import { useDocument, useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { Trophy, ArrowLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps({
  teamId: String,
})

const router = useRouter()
const teamRef = doc(db, 'teams', props.teamId)
const team = useDocument(teamRef)
const challengeDocs = useCollection(collection(db, 'teams', props.teamId, 'challenges'))

const challengeList = computed(() => {
  return CHALLENGES.map((ch) => {
    const result = challengeDocs.value?.find((d) => d.challengeId === ch.id)
      ?? { status: 'pending', score: 0 }
    return { ...ch, result }
  })
})

function statusBg(status) {
  if (status === 'completed') return 'bg-emerald-500/10 border-emerald-500/30'
  if (status === 'in_progress') return 'bg-amber-500/10 border-amber-500/30'
  if (status === 'failed') return 'bg-red-500/10 border-red-500/30'
  return 'bg-slate-700/30 border-slate-700/50'
}
</script>

<template>
  <div class="max-w-2xl mx-auto p-6">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <button @click="router.push('/')" class="text-slate-400 hover:text-white transition-colors">
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="flex-1">
        <h1 class="text-2xl font-bold">{{ team?.name ?? 'Loading...' }}</h1>
        <p class="text-slate-400 text-sm">Team Dashboard</p>
      </div>
    </div>

    <!-- Score card -->
    <div class="bg-gradient-to-r from-amber-500/20 to-amber-600/10 border border-amber-500/30 rounded-2xl p-6 mb-8">
      <div class="flex items-center gap-4">
        <div class="bg-amber-500/20 rounded-full p-3">
          <Trophy class="w-8 h-8 text-amber-400" />
        </div>
        <div>
          <p class="text-slate-300 text-sm font-medium">Total Score</p>
          <p class="text-4xl font-extrabold text-amber-400">{{ team?.totalScore ?? 0 }}</p>
        </div>
      </div>
    </div>

    <!-- Challenge list -->
    <h2 class="text-lg font-semibold mb-4">Challenges</h2>
    <div class="space-y-3">
      <router-link
        v-for="ch in challengeList"
        :key="ch.id"
        :to="{ name: 'ChallengeDetail', params: { teamId, challengeId: ch.id } }"
        class="block rounded-xl border p-4 transition-all hover:scale-[1.01]"
        :class="statusBg(ch.result.status)"
      >
        <div class="flex items-center gap-4">
          <span class="text-3xl">{{ ch.icon }}</span>
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold truncate">{{ ch.name }}</h3>
            <div class="flex items-center gap-2 mt-1">
              <span
                class="text-xs font-medium px-2 py-0.5 rounded-full"
                :class="{
                  'bg-emerald-500/20 text-emerald-400': ch.result.status === 'completed',
                  'bg-amber-500/20 text-amber-400': ch.result.status === 'in_progress',
                  'bg-red-500/20 text-red-400': ch.result.status === 'failed',
                  'bg-slate-600/30 text-slate-400': ch.result.status === 'pending',
                }"
              >
                {{ ch.result.status === 'in_progress' ? 'In Progress' : ch.result.status }}
              </span>
              <span v-if="ch.result.score > 0" class="text-amber-400 text-sm font-semibold">
                +{{ ch.result.score }} pts
              </span>
            </div>
          </div>
          <ChevronRight class="w-5 h-5 text-slate-500" />
        </div>
      </router-link>
    </div>
  </div>
</template>
