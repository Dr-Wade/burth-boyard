<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { Castle, Mail, Lock, LogIn } from 'lucide-vue-next'

const router = useRouter()
const { signInWithEmail, signInWithGoogle } = useAuth()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref(null)

const ERROR_MESSAGES = {
  'auth/invalid-credential': 'Identifiant ou mot de passe incorrect.',
  'auth/user-not-found': 'Aucun compte trouvé avec cet e-mail.',
  'auth/wrong-password': 'Mot de passe incorrect.',
  'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
  'auth/user-disabled': 'Ce compte a été désactivé.',
}

async function handleGoogleLogin() {
  error.value = null
  loading.value = true
  try {
    await signInWithGoogle()
    router.push({ name: 'Home' })
  } catch (e) {
    error.value = ERROR_MESSAGES[e.code] ?? 'Connexion Google échouée. Veuillez réessayer.'
  } finally {
    loading.value = false
  }
}

function resolveEmail(input) {
  const trimmed = input.trim()
  return trimmed.includes('@') ? trimmed : `${trimmed}@burth-boyard.app`
}

async function handleLogin() {
  error.value = null
  loading.value = true
  try {
    await signInWithEmail(resolveEmail(email.value), password.value)
    router.push({ name: 'Home' })
  } catch (e) {
    error.value = ERROR_MESSAGES[e.code] ?? 'Connexion échouée. Veuillez réessayer.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-6">
    <div class="text-center mb-10">
      <Castle class="w-16 h-16 mx-auto mb-4 text-amber-400" />
      <h1 class="text-5xl font-extrabold tracking-tight mb-2">
        <span class="text-amber-400">Burth</span> Boyard
      </h1>
      <p class="text-slate-400 text-lg">Suivi des scores</p>
    </div>

    <div class="w-full max-w-sm">
      <form
        @submit.prevent="handleLogin"
        class="bg-slate-800/60 backdrop-blur rounded-2xl p-8 border border-slate-700/50 space-y-5"
      >
        <!-- Email -->
        <div class="space-y-1.5">
          <label class="text-sm text-slate-400 flex items-center gap-1.5">
            <Mail class="w-3.5 h-3.5" /> Identifiant ou e-mail
          </label>
          <input
            v-model="email"
            type="text"
            autocomplete="username"
            required
            placeholder="identifiant ou vous@exemple.com"
            class="w-full bg-slate-900/60 border border-slate-700/60 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors"
          />
        </div>

        <!-- Password -->
        <div class="space-y-1.5">
          <label class="text-sm text-slate-400 flex items-center gap-1.5">
            <Lock class="w-3.5 h-3.5" /> Mot de passe
          </label>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            placeholder="••••••••"
            class="w-full bg-slate-900/60 border border-slate-700/60 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors"
          />
        </div>

        <!-- Error -->
        <p v-if="error" class="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <!-- Submit -->
        <button
          type="submit"
          :disabled="loading"
          class="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold py-3 rounded-xl transition-colors"
        >
          <LogIn class="w-4 h-4" />
          {{ loading ? 'Connexion…' : 'Se connecter' }}
        </button>
      </form>

      <!-- Divider -->
      <div class="flex items-center gap-3 my-4">
        <div class="flex-1 h-px bg-slate-700/60"></div>
        <span class="text-xs text-slate-500">ou</span>
        <div class="flex-1 h-px bg-slate-700/60"></div>
      </div>

      <!-- Google sign-in -->
      <button
        @click="handleGoogleLogin"
        :disabled="loading"
        class="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold py-3 px-6 rounded-xl transition-colors"
      >
        <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Se connecter avec Google
      </button>
    </div>
  </div>
</template>
