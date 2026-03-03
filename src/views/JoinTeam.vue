<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { collection, addDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { Castle, Users, Plus, ArrowRight, Shield } from 'lucide-vue-next'

const router = useRouter()
const teamName = ref('')
const existingTeams = ref([])
const loading = ref(true)
const creating = ref(false)

async function loadTeams() {
  loading.value = true
  const snap = await getDocs(collection(db, 'teams'))
  existingTeams.value = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  loading.value = false
}

loadTeams()

async function createTeam() {
  if (!teamName.value.trim()) return
  creating.value = true
  try {
    const challengeResults = {}
    for (const ch of CHALLENGES) {
      challengeResults[ch.id] = {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        failed: false,
        score: 0,
        factors: {},
      }
    }
    const docRef = await addDoc(collection(db, 'teams'), {
      name: teamName.value.trim(),
      totalScore: 0,
      challengeResults,
      createdAt: new Date(),
    })
    router.push({ name: 'TeamDashboard', params: { teamId: docRef.id } })
  } finally {
    creating.value = false
  }
}

function joinTeam(teamId) {
  router.push({ name: 'TeamDashboard', params: { teamId } })
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-6">
    <div class="text-center mb-12">
      <Castle class="w-16 h-16 mx-auto mb-4 text-amber-400" />
      <h1 class="text-5xl font-extrabold tracking-tight mb-2">
        <span class="text-amber-400">Burth</span> Boyard
      </h1>
      <p class="text-slate-400 text-lg">Team Score Tracker</p>
    </div>

    <div class="w-full max-w-md space-y-8">
      <!-- Create team -->
      <div class="bg-slate-800/60 backdrop-blur rounded-2xl p-6 border border-slate-700/50">
        <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus class="w-5 h-5 text-amber-400" />
          Create a New Team
        </h2>
        <form @submit.prevent="createTeam" class="flex gap-3">
          <input
            v-model="teamName"
            type="text"
            placeholder="Team name..."
            class="flex-1 bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
          />
          <button
            type="submit"
            :disabled="!teamName.trim() || creating"
            class="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            <span v-if="creating">...</span>
            <span v-else>Create</span>
          </button>
        </form>
      </div>

      <!-- Join existing -->
      <div class="bg-slate-800/60 backdrop-blur rounded-2xl p-6 border border-slate-700/50">
        <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users class="w-5 h-5 text-amber-400" />
          Join Existing Team
        </h2>
        <div v-if="loading" class="text-slate-400 text-center py-4">Loading teams...</div>
        <div v-else-if="existingTeams.length === 0" class="text-slate-500 text-center py-4">
          No teams yet. Create one above!
        </div>
        <div v-else class="space-y-2">
          <button
            v-for="team in existingTeams"
            :key="team.id"
            @click="joinTeam(team.id)"
            class="w-full flex items-center justify-between bg-slate-700/40 hover:bg-slate-700/70 rounded-xl px-4 py-3 transition-colors group"
          >
            <span class="font-medium">{{ team.name }}</span>
            <ArrowRight class="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
          </button>
        </div>
      </div>

      <!-- Admin link -->
      <div class="text-center">
        <router-link
          to="/admin"
          class="inline-flex items-center gap-2 text-slate-500 hover:text-amber-400 text-sm transition-colors"
        >
          <Shield class="w-4 h-4" />
          Admin Panel
        </router-link>
      </div>
    </div>
  </div>
</template>
