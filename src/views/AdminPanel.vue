<script setup>
import { computed } from 'vue'
import { collection } from 'firebase/firestore'
import { useCollection, useCurrentUser } from 'vuefire'
import { useRouter } from 'vue-router'
import { db } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { useAuth } from '../composables/useAuth'
import { Shield, ChevronRight, ArrowLeft, Users, LogOut } from 'lucide-vue-next'

const router = useRouter()
const user = useCurrentUser()
const { signOut } = useAuth()
const teams = useCollection(collection(db, 'teams'))

const rankedTeams = computed(() => {
  if (!teams.value) return []
  return [...teams.value].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
})

async function handleSignOut() {
  await signOut()
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="max-w-3xl mx-auto p-6">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <button @click="router.push('/')" class="text-slate-400 hover:text-white transition-colors">
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="flex-1">
        <h1 class="text-2xl font-bold flex items-center gap-2">
          <Shield class="w-6 h-6 text-amber-400" />
          Admin Panel
        </h1>
        <p class="text-slate-400 text-sm">Team rankings &amp; overview</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-slate-400 text-sm hidden sm:block">{{ user?.displayName }}</span>
        <button @click="handleSignOut" class="text-slate-500 hover:text-white transition-colors" title="Sign out">
          <LogOut class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="!teams" class="text-center text-slate-400 py-12">Loading teams...</div>

    <!-- Empty -->
    <div v-else-if="teams.length === 0" class="text-center py-12">
      <Users class="w-12 h-12 mx-auto text-slate-600 mb-3" />
      <p class="text-slate-400">No teams registered yet.</p>
    </div>

    <!-- Rankings -->
    <div v-else class="space-y-3">
      <router-link
        v-for="(team, index) in rankedTeams"
        :key="team.id"
        :to="{ name: 'AdminTeamDetail', params: { teamId: team.id } }"
        class="block bg-slate-800/60 border border-slate-700/50 hover:border-slate-600 rounded-xl p-5 transition-all hover:scale-[1.01]"
      >
        <div class="flex items-center gap-4">
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

          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-lg truncate">{{ team.name }}</h3>
            <p class="text-slate-400 text-sm">{{ CHALLENGES.length }} challenges total</p>
          </div>

          <div class="text-right shrink-0 mr-2">
            <p class="text-2xl font-extrabold text-amber-400">{{ team.totalScore ?? 0 }}</p>
            <p class="text-slate-500 text-xs">points</p>
          </div>

          <ChevronRight class="w-5 h-5 text-slate-500 shrink-0" />
        </div>
      </router-link>
    </div>
  </div>
</template>
