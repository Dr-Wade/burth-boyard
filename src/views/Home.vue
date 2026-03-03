<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { collection, addDoc, getDocs } from 'firebase/firestore'
import { useCurrentUser } from 'vuefire'
import { db } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { useAuth } from '../composables/useAuth'
import { Castle, Users, Plus, ArrowRight, Shield, LogOut } from 'lucide-vue-next'

const router = useRouter()
const user = useCurrentUser()
const { userProfile, loadUserProfile, isAdmin, signOut } = useAuth()

const teamName = ref('')
const existingTeams = ref([])
const loading = ref(true)
const creating = ref(false)

onMounted(async () => {
  if (user.value) await loadUserProfile(user.value.uid)
  await loadTeams()
})

async function loadTeams() {
  loading.value = true
  const snap = await getDocs(collection(db, 'teams'))
  existingTeams.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  loading.value = false
}

async function createTeam() {
  if (!teamName.value.trim()) return
  creating.value = true
  try {
    const teamRef = await addDoc(collection(db, 'teams'), {
      name: teamName.value.trim(),
      totalScore: 0,
      leaderUid: user.value?.uid ?? null,
      createdAt: new Date(),
    })
    // Initialise challenge subcollection documents
    for (const ch of CHALLENGES) {
      await addDoc(collection(db, 'teams', teamRef.id, 'challenges'), {
        challengeId: ch.id,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        failed: false,
        score: 0,
        factors: {},
      })
    }
    router.push({ name: 'TeamDashboard', params: { teamId: teamRef.id } })
  } finally {
    creating.value = false
  }
}

function joinTeam(teamId) {
  router.push({ name: 'TeamDashboard', params: { teamId } })
}

async function handleSignOut() {
  await signOut()
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-6">
    <!-- Header bar -->
    <div class="w-full max-w-md flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Castle class="w-7 h-7 text-amber-400" />
        <span class="font-bold text-lg">Burth Boyard</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-slate-400 text-sm">{{ user?.displayName }}</span>
        <button @click="handleSignOut" class="text-slate-500 hover:text-white transition-colors" title="Sign out">
          <LogOut class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- No role assigned yet -->
    <div
      v-if="userProfile && !userProfile.role"
      class="w-full max-w-md bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 text-center"
    >
      <p class="text-amber-300 font-semibold mb-1">Account pending</p>
      <p class="text-slate-400 text-sm">
        Your account has been created. Please ask an admin to assign you a role.
      </p>
    </div>

    <template v-else-if="userProfile">
      <div class="w-full max-w-md space-y-6">
        <!-- Admin shortcut -->
        <router-link
          v-if="isAdmin"
          to="/admin"
          class="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 hover:border-amber-400/50 rounded-2xl p-4 transition-colors group"
        >
          <Shield class="w-6 h-6 text-amber-400" />
          <div class="flex-1">
            <p class="font-semibold">Admin Panel</p>
            <p class="text-slate-400 text-sm">View all teams & rankings</p>
          </div>
          <ArrowRight class="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
        </router-link>

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
      </div>
    </template>
  </div>
</template>
