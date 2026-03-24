<script setup>
import { watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useCurrentUser } from 'vuefire'
import { useAuth } from '../composables/useAuth'
import { Castle, ArrowRight, Shield, LogOut } from 'lucide-vue-next'

const router = useRouter()
const user = useCurrentUser()
const { userProfile, isAdmin, signOut, loadUserProfile } = useAuth()

watch(
  user,
  (value) => {
    if (value?.uid) {
      loadUserProfile(value.uid)
    }
  },
  { immediate: true },
)

// Auto-redirect based on role
watchEffect(() => {
  if (!userProfile.value) return
  if (userProfile.value.role === 'admin') {
    router.replace({ name: 'AdminPanel' })
  } else if (userProfile.value.role === 'team-leader' && userProfile.value.teamId) {
    router.replace({ name: 'TeamDashboard', params: { teamId: userProfile.value.teamId } })
  }
})

async function handleSignOut() {
  await signOut()
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Header bar (fixed to top) -->
    <div class="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50 p-6">
      <div class="w-full max-w-md mx-auto flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Castle class="w-7 h-7 text-amber-400" />
          <span class="font-bold text-lg">Fort Boyard</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-slate-400 text-sm">{{ user?.displayName }}</span>
          <button @click="handleSignOut" class="text-slate-500 hover:text-white transition-colors" title="Se déconnecter">
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="min-h-screen flex flex-col items-center justify-center p-6 pt-28">

      <!-- No role assigned -->
      <div
        v-if="userProfile && !userProfile.role"
        class="w-full max-w-md bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 text-center"
      >
        <p class="text-amber-300 font-semibold mb-1">Compte en attente</p>
        <p class="text-slate-400 text-sm">
          Votre compte a été créé. Demandez à un administrateur de vous attribuer un rôle.
        </p>
      </div>

      <!-- Admin -->
      <div v-else-if="isAdmin" class="w-full max-w-md">
        <router-link
          to="/admin"
          class="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 hover:border-amber-400/50 rounded-2xl p-5 transition-colors group"
        >
          <Shield class="w-6 h-6 text-amber-400" />
          <div class="flex-1">
            <p class="font-semibold">Panneau Admin</p>
            <p class="text-slate-400 text-sm">Voir toutes les équipes et classements</p>
          </div>
          <ArrowRight class="w-5 h-5 text-slate-500 group-hover:text-amber-400 transition-colors" />
        </router-link>
      </div>

      <!-- Team leader without a team assigned yet (edge case) -->
      <div
        v-else-if="userProfile?.role === 'team-leader' && !userProfile?.teamId"
        class="w-full max-w-md bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 text-center"
      >
        <p class="text-slate-300 font-semibold mb-1">Aucune équipe assignée</p>
        <p class="text-slate-400 text-sm">Un administrateur vous assignera à une équipe bientôt.</p>
      </div>

      <!-- Loading / redirecting -->
      <div v-else-if="!userProfile" class="text-slate-500 text-sm">Chargement...</div>

    </div>
  </div>
</template>
