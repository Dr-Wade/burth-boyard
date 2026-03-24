import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser } from 'vuefire'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

import Login from './views/Login.vue'
import TeamDashboard from './views/TeamDashboard.vue'
import ChallengeDetail from './views/ChallengeDetail.vue'
import AdminPanel from './views/AdminPanel.vue'
import AdminTeamDetail from './views/AdminTeamDetail.vue'
import AdminUsers from './views/AdminUsers.vue'
import Home from './views/Home.vue'
import FinalPhase from './views/FinalPhase.vue'

const routes = [
  { path: '/login', name: 'Login', component: Login },
  { path: '/', name: 'Home', component: Home, meta: { requiresAuth: true } },
  { path: '/team/:teamId', name: 'TeamDashboard', component: TeamDashboard, props: true, meta: { requiresAuth: true } },
  { path: '/team/:teamId/challenge/:challengeId', name: 'ChallengeDetail', component: ChallengeDetail, props: true, meta: { requiresAuth: true } },
  { path: '/admin', name: 'AdminPanel', component: AdminPanel, meta: { requiresAuth: true, requiresAdmin: true } },
  { path: '/admin/team/:teamId', name: 'AdminTeamDetail', component: AdminTeamDetail, props: true, meta: { requiresAuth: true, requiresAdmin: true } },
  { path: '/admin/users', name: 'AdminUsers', component: AdminUsers, meta: { requiresAuth: true, requiresAdmin: true } },
  { path: '/team/:teamId/final', name: 'FinalPhase', component: FinalPhase, props: true, meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  const user = await getCurrentUser()
  if (!user) return { name: 'Login' }

  console.log(user);

  if (to.meta.requiresAdmin) {
    const snap = await getDoc(doc(db, 'users', user.uid))
    const role = snap.data()?.role
    if (role !== 'admin') return { name: 'Home' }
  }

  return true
})

export default router
