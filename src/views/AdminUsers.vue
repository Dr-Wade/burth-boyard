<script setup>
import { ref, computed } from 'vue'
import { collection, doc, updateDoc, addDoc, deleteDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useCollection } from 'vuefire'
import { useRouter } from 'vue-router'
import { db, functions } from '../firebase'
import { CHALLENGES } from '../data/challenges'
import { ArrowLeft, Settings, Check, Users, UserPlus, Plus, Trash2, X, KeyRound, Lightbulb } from 'lucide-vue-next'

const router = useRouter()
const users = useCollection(collection(db, 'users'))
const teams = useCollection(collection(db, 'teams'))

const activeTab = ref('teams')

// ── Teams ──────────────────────────────────────────────────────────────────
const newTeamName = ref('')
const creatingTeam = ref(false)
const deletingTeamId = ref(null)
const confirmDeleteTeamId = ref(null)
const expandedFinalId = ref(null) // which team has final config expanded
const editingTeamDisplayName = ref({})
const teamDisplayNameDraft = ref({})
const savingTeamDisplayName = ref({})
const teamDisplayNameError = ref({})

// Final phase config per team
const teamFinalConfigs = ref({}) // { [teamId]: { secretWord, hints: string[] } }
const savingFinal = ref({})
const finalSaveError = ref({})
const finalSaved = ref({})

function toggleFinal(teamId) {
  if (expandedFinalId.value === teamId) {
    expandedFinalId.value = null
  } else {
    expandedFinalId.value = teamId
    // Pre-populate from existing team data if available
    const team = teams.value?.find(t => t.id === teamId)
    if (team && !teamFinalConfigs.value[teamId]) {
      teamFinalConfigs.value[teamId] = {
        secretWord: team.finalSecretWord ?? '',
        hints: team.finalHints?.length ? [...team.finalHints] : [''],
      }
    } else if (!teamFinalConfigs.value[teamId]) {
      teamFinalConfigs.value[teamId] = { secretWord: '', hints: [''] }
    }
  }
}

function startEditTeamDisplayName(team) {
  teamDisplayNameDraft.value[team.id] = team.displayName ?? team.name ?? ''
  teamDisplayNameError.value[team.id] = null
  editingTeamDisplayName.value[team.id] = true
}

function cancelEditTeamDisplayName(team) {
  teamDisplayNameDraft.value[team.id] = team.displayName ?? team.name ?? ''
  teamDisplayNameError.value[team.id] = null
  editingTeamDisplayName.value[team.id] = false
}

async function saveTeamDisplayName(team) {
  const nextDisplayName = String(teamDisplayNameDraft.value[team.id] ?? '').trim()
  if (!nextDisplayName) {
    teamDisplayNameError.value[team.id] = 'Le nom affiché est requis.'
    return
  }

  savingTeamDisplayName.value[team.id] = true
  teamDisplayNameError.value[team.id] = null
  try {
    await updateDoc(doc(db, 'teams', team.id), { displayName: nextDisplayName })
    editingTeamDisplayName.value[team.id] = false
  } catch (e) {
    teamDisplayNameError.value[team.id] = e.message ?? "Impossible de mettre à jour le nom d'affichage."
  } finally {
    savingTeamDisplayName.value[team.id] = false
  }
}

function ensureFinalConfig(teamId) {
  if (!teamFinalConfigs.value[teamId]) {
    teamFinalConfigs.value[teamId] = { secretWord: '', hints: [''] }
  }
}
function addFinalHint(teamId) {
  ensureFinalConfig(teamId)
  if (teamFinalConfigs.value[teamId].hints.length < 12)
    teamFinalConfigs.value[teamId].hints.push('')
}
function removeFinalHint(teamId, i) {
  ensureFinalConfig(teamId)
  teamFinalConfigs.value[teamId].hints.splice(i, 1)
}

async function saveFinalConfig(teamId) {
  ensureFinalConfig(teamId)
  savingFinal.value[teamId] = true
  finalSaveError.value[teamId] = null
  finalSaved.value[teamId] = false
  try {
    const cfg = teamFinalConfigs.value[teamId]
    await httpsCallable(functions, 'setFinalPhase')({
      teamConfigs: [{
        teamId,
        secretWord: cfg.secretWord.trim(),
        hints: cfg.hints.map(h => h.trim()).filter(Boolean),
      }],
    })
    finalSaved.value[teamId] = true
    setTimeout(() => { finalSaved.value[teamId] = false }, 2000)
  } catch (e) {
    finalSaveError.value[teamId] = e.message ?? 'Failed to save.'
  } finally {
    savingFinal.value[teamId] = false
  }
}

async function handleCreateTeam() {
  if (!newTeamName.value.trim()) return
  creatingTeam.value = true
  try {
    const rawName = newTeamName.value.trim()
    const teamRef = await addDoc(collection(db, 'teams'), {
      name: rawName,
      displayName: rawName,
      totalScore: 0,
      leaderUid: null,
      createdAt: new Date(),
    })
    for (const ch of CHALLENGES) {
      await addDoc(collection(db, 'teams', teamRef.id, 'challenges'), {
        teamId: teamRef.id,
        challengeId: ch.id,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        failed: false,
        score: 0,
        factors: {},
      })
    }
    newTeamName.value = ''
  } finally {
    creatingTeam.value = false
  }
}

async function handleDeleteTeam(team) {
  if (confirmDeleteTeamId.value !== team.id) {
    confirmDeleteTeamId.value = team.id
    return
  }
  confirmDeleteTeamId.value = null
  deletingTeamId.value = team.id
  try {
    const challengesSnap = await getDocs(collection(db, 'teams', team.id, 'challenges'))
    await Promise.all(challengesSnap.docs.map((d) => deleteDoc(d.ref)))
    await deleteDoc(doc(db, 'teams', team.id))
  } finally {
    deletingTeamId.value = null
  }
}

function teamLeaderName(team) {
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

// ── Users ──────────────────────────────────────────────────────────────────
const saving = ref({})
const savingTeam = ref({})
const editingUserDisplayName = ref({})
const userDisplayNameDraft = ref({})
const savingUserDisplayName = ref({})
const userDisplayNameError = ref({})
const deletingUserId = ref(null)
const confirmDeleteUserId = ref(null)
const showCreateForm = ref(false)
const creating = ref(false)
const createError = ref(null)
const newUser = ref({ username: '', password: '', displayName: '', role: null, teamId: null })

const ROLES = [
  { value: null, label: 'Aucun rôle' },
  { value: 'team-leader', label: 'Chef d\'équipe' },
  { value: 'admin', label: 'Admin' },
]

async function handleCreateUser() {
  createError.value = null
  creating.value = true
  try {
    const { data } = await httpsCallable(functions, 'createUser')({
      username: newUser.value.username.trim(),
      password: newUser.value.password,
      displayName: newUser.value.displayName.trim(),
      role: newUser.value.role,
    })
    if (newUser.value.role === 'team-leader' && newUser.value.teamId) {
      await updateDoc(doc(db, 'teams', newUser.value.teamId), { leaderUid: data.uid })
      await updateDoc(doc(db, 'users', data.uid), { teamId: newUser.value.teamId })
    }
    newUser.value = { username: '', password: '', displayName: '', role: null, teamId: null }
    showCreateForm.value = false
  } catch (e) {
    createError.value = e.message ?? 'Impossible de créer l\'utilisateur.'
  } finally {
    creating.value = false
  }
}

function resolvedEmail(username) {
  const t = username.trim()
  return t.includes('@') ? t : t ? `${t}@burth-boyard.app` : ''
}

async function setRole(userId, role) {
  saving.value[userId] = true
  try {
    await updateDoc(doc(db, 'users', userId), { role: role ?? null })
  } finally {
    saving.value[userId] = false
  }
}

async function setTeam(u, teamId) {
  savingTeam.value[u.id] = true
  try {
    const prevTeamId = u.teamId
    if (prevTeamId && prevTeamId !== teamId) {
      await updateDoc(doc(db, 'teams', prevTeamId), { leaderUid: null })
    }
    if (teamId) {
      await updateDoc(doc(db, 'teams', teamId), { leaderUid: u.id })
    }
    await updateDoc(doc(db, 'users', u.id), { teamId: teamId ?? null })
  } finally {
    savingTeam.value[u.id] = false
  }
}

function startEditUserDisplayName(u) {
  userDisplayNameDraft.value[u.id] = u.displayName ?? ''
  userDisplayNameError.value[u.id] = null
  editingUserDisplayName.value[u.id] = true
}

function cancelEditUserDisplayName(u) {
  userDisplayNameDraft.value[u.id] = u.displayName ?? ''
  userDisplayNameError.value[u.id] = null
  editingUserDisplayName.value[u.id] = false
}

async function saveUserDisplayName(u) {
  const nextDisplayName = String(userDisplayNameDraft.value[u.id] ?? '').trim()
  if (!nextDisplayName) {
    userDisplayNameError.value[u.id] = 'Le nom affiché est requis.'
    return
  }

  savingUserDisplayName.value[u.id] = true
  userDisplayNameError.value[u.id] = null
  try {
    await updateDoc(doc(db, 'users', u.id), { displayName: nextDisplayName })
    editingUserDisplayName.value[u.id] = false
  } catch (e) {
    userDisplayNameError.value[u.id] = e.message ?? 'Impossible de mettre à jour le nom affiché.'
  } finally {
    savingUserDisplayName.value[u.id] = false
  }
}

function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label ?? 'Aucun rôle'
}

function roleBadgeClass(role) {
  if (role === 'admin') return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  if (role === 'team-leader') return 'bg-sky-500/20 text-sky-400 border-sky-500/30'
  return 'bg-slate-600/30 text-slate-400 border-slate-600/30'
}

async function handleDeleteUser(u) {
  if (confirmDeleteUserId.value !== u.id) {
    confirmDeleteUserId.value = u.id
    return
  }
  confirmDeleteUserId.value = null
  deletingUserId.value = u.id
  try {
    await httpsCallable(functions, 'deleteUser')({ userId: u.id })
  } catch (e) {
    createError.value = e.message ?? 'Impossible de supprimer l\'utilisateur.'
  } finally {
    deletingUserId.value = null
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
          <h1 class="text-2xl font-bold flex items-center gap-2">
            <Settings class="w-6 h-6 text-amber-400" />
            Configuration
          </h1>
          <p class="text-slate-400 text-sm">Gérer les équipes et utilisateurs</p>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="max-w-3xl mx-auto p-6 pt-28">

      <!-- Tabs -->
      <div class="flex gap-1 bg-slate-800/60 border border-slate-700/50 rounded-xl p-1 mb-6">
        <button
          @click="activeTab = 'teams'"
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
          :class="activeTab === 'teams' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'"
        >
          <Users class="w-4 h-4" />
          Équipes <span class="text-xs opacity-60">({{ teams?.length ?? 0 }})</span>
        </button>
        <button
          @click="activeTab = 'users'"
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
          :class="activeTab === 'users' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'"
        >
          <UserPlus class="w-4 h-4" />
          Utilisateurs <span class="text-xs opacity-60">({{ users?.length ?? 0 }})</span>
        </button>
      </div>

      <!-- ── TEAMS TAB ── -->
      <div v-if="activeTab === 'teams'" class="space-y-4">

        <!-- Create team form -->
        <form @submit.prevent="handleCreateTeam" class="flex gap-3">
          <input
            v-model="newTeamName"
            required
            placeholder="Nom de l'équipe…"
            class="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition-colors"
          />
          <button
            type="submit"
            :disabled="!newTeamName.trim() || creatingTeam"
            class="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold px-5 py-3 rounded-xl transition-colors shrink-0"
          >
            <Plus class="w-4 h-4" />
            {{ creatingTeam ? '…' : 'Ajouter' }}
          </button>
        </form>

        <!-- Team list -->
        <div v-if="!teams || teams.length === 0" class="text-center py-10 text-slate-500">
          Aucune équipe. Créez-en une ci-dessus.
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="team in teams"
            :key="team.id"
            class="bg-slate-800/60 border rounded-xl transition-colors"
            :class="confirmDeleteTeamId === team.id ? 'border-red-500/40' : 'border-slate-700/50'"
          >
            <!-- Team row -->
            <div class="p-4 flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <div v-if="editingTeamDisplayName[team.id]" class="space-y-2">
                  <div class="flex items-center gap-2">
                    <input
                      v-model="teamDisplayNameDraft[team.id]"
                      required
                      class="flex-1 min-w-0 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors"
                      placeholder="Nom affiché"
                    />
                    <button
                      @click="saveTeamDisplayName(team)"
                      :disabled="savingTeamDisplayName[team.id] || !String(teamDisplayNameDraft[team.id] ?? '').trim()"
                      class="shrink-0 text-xs bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      {{ savingTeamDisplayName[team.id] ? '…' : 'OK' }}
                    </button>
                    <button
                      @click="cancelEditTeamDisplayName(team)"
                      :disabled="savingTeamDisplayName[team.id]"
                      class="shrink-0 text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                  <p v-if="teamDisplayNameError[team.id]" class="text-xs text-red-400">{{ teamDisplayNameError[team.id] }}</p>
                </div>
                <p v-else class="font-semibold truncate">{{ formatTeamName(team) }}</p>
                <p class="text-sm truncate" :class="teamLeaderName(team) ? 'text-sky-400' : 'text-slate-500 italic'">
                  {{ teamLeaderName(team) ?? 'Aucun chef assigné' }}
                </p>
                <!-- Final phase status badge -->
                <div class="flex items-center gap-2 mt-1">
                  <span
                    v-if="team.finalSecretWord"
                    class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                  >
                    <KeyRound class="w-3 h-3" />
                    Mot configuré · {{ team.finalHints?.length ?? 0 }} indice{{ (team.finalHints?.length ?? 0) !== 1 ? 's' : '' }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-500 border border-slate-600/30"
                  >
                    <KeyRound class="w-3 h-3" />
                    Phase finale non configurée
                  </span>
                </div>
              </div>
              <p class="text-amber-400 text-sm font-semibold shrink-0">{{ team.totalScore ?? 0 }} pts</p>
              <button
                v-if="!editingTeamDisplayName[team.id]"
                @click="startEditTeamDisplayName(team)"
                class="shrink-0 text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                title="Renommer l'équipe"
              >
                Renommer
              </button>
              <!-- Final config toggle -->
              <button
                @click="toggleFinal(team.id)"
                class="shrink-0 p-2 rounded-lg transition-colors"
                :class="expandedFinalId === team.id
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10'"
                title="Configurer la phase finale"
              >
                <KeyRound class="w-4 h-4" />
              </button>
              <button
                @click="handleDeleteTeam(team)"
                :disabled="deletingTeamId === team.id"
                class="shrink-0 p-2 rounded-lg transition-colors disabled:opacity-40"
                :class="confirmDeleteTeamId === team.id
                  ? 'bg-red-500 text-white'
                  : 'text-slate-600 hover:text-red-400 hover:bg-red-500/10'"
                :title="confirmDeleteTeamId === team.id ? 'Cliquez à nouveau pour confirmer' : 'Supprimer l\'équipe'"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>

            <!-- Expandable final phase config -->
            <div v-if="expandedFinalId === team.id" class="border-t border-slate-700/50 px-4 pb-4 pt-3 space-y-3">
              <p class="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                <KeyRound class="w-3.5 h-3.5" /> Phase Finale
              </p>
              <div class="space-y-1">
                <label class="text-xs text-slate-400">Mot secret</label>
                <input
                  :value="teamFinalConfigs[team.id]?.secretWord ?? ''"
                  @input="ensureFinalConfig(team.id); teamFinalConfigs[team.id].secretWord = $event.target.value"
                  placeholder="Le mot à deviner…"
                  class="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors"
                />
              </div>
              <div class="space-y-2">
                <label class="text-xs text-slate-400 flex items-center gap-1.5">
                  <Lightbulb class="w-3.5 h-3.5" /> Indices (ordre d'apparition)
                </label>
                <div
                  v-for="(hint, i) in (teamFinalConfigs[team.id]?.hints ?? [''])"
                  :key="i"
                  class="flex gap-2"
                >
                  <input
                    :value="hint"
                    @input="ensureFinalConfig(team.id); teamFinalConfigs[team.id].hints[i] = $event.target.value"
                    :placeholder="`Indice ${i + 1}…`"
                    class="flex-1 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors"
                  />
                  <button type="button" @click="removeFinalHint(team.id, i)" class="text-slate-500 hover:text-red-400 p-1.5 shrink-0">
                    <X class="w-4 h-4" />
                  </button>
                </div>
                <button
                  type="button"
                  @click="addFinalHint(team.id)"
                  :disabled="(teamFinalConfigs[team.id]?.hints ?? []).length >= 12"
                  class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                >
                  <Plus class="w-3.5 h-3.5" /> Ajouter un indice
                </button>
              </div>
              <p v-if="finalSaveError[team.id]" class="text-sm text-red-400">{{ finalSaveError[team.id] }}</p>
              <button
                @click="saveFinalConfig(team.id)"
                :disabled="savingFinal[team.id] || !(teamFinalConfigs[team.id]?.secretWord?.trim())"
                class="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 font-semibold px-4 py-2 rounded-xl transition-colors text-sm"
              >
                {{ finalSaved[team.id] ? '✓ Sauvegardé' : savingFinal[team.id] ? 'Sauvegarde…' : 'Sauvegarder' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── USERS TAB ── -->
      <div v-if="activeTab === 'users'" class="space-y-4">

        <!-- Create user button / form -->
        <div>
          <button
            v-if="!showCreateForm"
            @click="showCreateForm = true"
            class="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <UserPlus class="w-4 h-4" />
            Créer un utilisateur
          </button>

          <form
            v-else
            @submit.prevent="handleCreateUser"
            class="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 space-y-4"
          >
            <div class="flex items-center justify-between">
              <h3 class="font-semibold flex items-center gap-2">
                <UserPlus class="w-4 h-4 text-amber-400" /> Nouvel utilisateur
              </h3>
              <button type="button" @click="showCreateForm = false; createError = null" class="text-slate-500 hover:text-white">
                <X class="w-4 h-4" />
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="space-y-1">
                <label class="text-xs text-slate-400">Nom affiché</label>
                <input v-model="newUser.displayName" required placeholder="Équipe Super"
                  class="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-slate-400">
                  Identifiant
                  <span v-if="newUser.username" class="text-slate-500 ml-1">→ {{ resolvedEmail(newUser.username) }}</span>
                </label>
                <input v-model="newUser.username" required placeholder="identifiant ou email@complet.com"
                  class="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-slate-400">Mot de passe</label>
                <input v-model="newUser.password" type="password" required minlength="6" placeholder="min. 6 caractères"
                  class="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-slate-400">Rôle</label>
                <div class="flex gap-2 flex-wrap pt-1">
                  <button
                    v-for="role in ROLES" :key="String(role.value)" type="button"
                    @click="newUser.role = role.value; if (role.value !== 'team-leader') newUser.teamId = null"
                    class="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                    :class="newUser.role === role.value ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/70'"
                  >
                    <Check v-if="newUser.role === role.value" class="w-3 h-3" />
                    {{ role.label }}
                  </button>
                </div>
              </div>
            </div>

            <div v-if="newUser.role === 'team-leader'" class="space-y-1">
              <label class="text-xs text-slate-400 flex items-center gap-1.5"><Users class="w-3.5 h-3.5" /> Assigner à une équipe</label>
              <div class="flex gap-2 flex-wrap">
                <button type="button" @click="newUser.teamId = null"
                  class="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                  :class="!newUser.teamId ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/70'">
                  <Check v-if="!newUser.teamId" class="w-3 h-3" /> Aucune équipe
                </button>
                <button v-for="team in teams" :key="team.id" type="button" @click="newUser.teamId = team.id"
                  class="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
                  :class="newUser.teamId === team.id ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/70'">
                  <Check v-if="newUser.teamId === team.id" class="w-3 h-3" /> {{ formatTeamName(team) }}
                </button>
              </div>
            </div>

            <p v-if="createError" class="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{{ createError }}</p>

            <button type="submit" :disabled="creating"
              class="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold py-2.5 rounded-xl transition-colors">
              <UserPlus class="w-4 h-4" />
              {{ creating ? 'Création…' : 'Créer l\'utilisateur' }}
            </button>
          </form>
        </div>

        <!-- User list -->
        <div v-if="!users || users.length === 0" class="text-center py-10 text-slate-500">
          Aucun utilisateur. Créez-en un ci-dessus.
        </div>
        <div v-else class="space-y-3">
          <div v-for="u in users" :key="u.id" class="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
            <div class="flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <div v-if="editingUserDisplayName[u.id]" class="space-y-2">
                  <div class="flex items-center gap-2">
                    <input
                      v-model="userDisplayNameDraft[u.id]"
                      required
                      class="flex-1 min-w-0 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors"
                      placeholder="Nom affiché"
                    />
                    <button
                      @click="saveUserDisplayName(u)"
                      :disabled="savingUserDisplayName[u.id] || !String(userDisplayNameDraft[u.id] ?? '').trim()"
                      class="shrink-0 text-xs bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      {{ savingUserDisplayName[u.id] ? '…' : 'OK' }}
                    </button>
                    <button
                      @click="cancelEditUserDisplayName(u)"
                      :disabled="savingUserDisplayName[u.id]"
                      class="shrink-0 text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                  <p v-if="userDisplayNameError[u.id]" class="text-xs text-red-400">{{ userDisplayNameError[u.id] }}</p>
                </div>
                <p v-else class="font-semibold truncate">{{ u.displayName }}</p>
                <p class="text-slate-400 text-sm truncate">{{ u.email }}</p>
              </div>
              <span class="hidden sm:inline-flex text-xs font-medium px-2.5 py-1 rounded-full border shrink-0" :class="roleBadgeClass(u.role)">
                {{ roleLabel(u.role) }}
              </span>
              <button
                v-if="!editingUserDisplayName[u.id]"
                @click="startEditUserDisplayName(u)"
                class="shrink-0 text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                title="Modifier le nom affiché"
              >
                Renommer
              </button>
              <button
                @click="handleDeleteUser(u)"
                :disabled="deletingUserId === u.id"
                class="shrink-0 p-2 rounded-lg transition-colors disabled:opacity-40"
                :class="confirmDeleteUserId === u.id
                  ? 'bg-red-500 text-white'
                  : 'text-slate-600 hover:text-red-400 hover:bg-red-500/10'"
                :title="confirmDeleteUserId === u.id ? 'Cliquez à nouveau pour confirmer' : 'Supprimer l\'utilisateur'"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>

            <div class="mt-3 flex gap-2 flex-wrap">
              <button v-for="role in ROLES" :key="String(role.value)"
                @click="setRole(u.id, role.value)" :disabled="saving[u.id]"
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                :class="u.role === role.value ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/70'">
                <Check v-if="u.role === role.value" class="w-3.5 h-3.5" />
                {{ role.label }}
              </button>
            </div>

            <div v-if="u.role === 'team-leader'" class="mt-3 border-t border-slate-700/50 pt-3">
              <label class="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-2">
                <Users class="w-3.5 h-3.5" /> Équipe assignée
              </label>
              <div class="flex gap-2 flex-wrap">
                <button @click="setTeam(u, null)" :disabled="savingTeam[u.id]"
                  class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                  :class="!u.teamId ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/70'">
                  <Check v-if="!u.teamId" class="w-3.5 h-3.5" /> Aucune équipe
                </button>
                <button v-for="team in teams" :key="team.id"
                  @click="setTeam(u, team.id)" :disabled="savingTeam[u.id]"
                  class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                  :class="u.teamId === team.id ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-semibold' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/70'">
                  <Check v-if="u.teamId === team.id" class="w-3.5 h-3.5" /> {{ formatTeamName(team) }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
