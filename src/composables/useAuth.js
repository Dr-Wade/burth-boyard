import { ref, computed, watch } from 'vue'
import { signInWithPopup, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { useCurrentUser } from 'vuefire'
import { auth, googleProvider, db } from '../firebase'

const userProfile = ref(null)
const profileLoading = ref(false)
let profileUnsub = null
let profileWatcherInitialized = false

export function useAuth() {
  const user = useCurrentUser()

  if (!profileWatcherInitialized) {
    profileWatcherInitialized = true
    watch(
      user,
      async (value) => {
        if (value?.uid) {
          await loadUserProfile(value.uid)
          return
        }
        if (profileUnsub) { profileUnsub(); profileUnsub = null }
        userProfile.value = null
        profileLoading.value = false
      },
      { immediate: true },
    )
  }

  const isAdmin = computed(() => userProfile.value?.role === 'admin')
  const isTeamLeader = computed(() => userProfile.value?.role === 'team-leader')

  async function loadUserProfile(uid) {
    profileLoading.value = true
    // Unsubscribe any previous listener
    if (profileUnsub) { profileUnsub(); profileUnsub = null }
    // Subscribe to realtime updates so admin-assigned teamId/role changes propagate
    profileUnsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      userProfile.value = snap.exists() ? { id: snap.id, ...snap.data() } : null
      profileLoading.value = false
    })
  }

  async function signInWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider)
    const { uid, displayName, email, photoURL } = result.user

    const userRef = doc(db, 'users', uid)
    const snap = await getDoc(userRef)

    if (!snap.exists()) {
      await setDoc(userRef, {
        displayName,
        email,
        photoURL,
        role: null,
        createdAt: new Date(),
      })
      userProfile.value = { id: uid, displayName, email, photoURL, role: null }
    } else {
      userProfile.value = { id: snap.id, ...snap.data() }
    }

    return userProfile.value
  }

  async function signInWithEmail(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password)
    await loadUserProfile(result.user.uid)
    return userProfile.value
  }

  async function signOut() {
    if (profileUnsub) { profileUnsub(); profileUnsub = null }
    await firebaseSignOut(auth)
    userProfile.value = null
  }

  return {
    user,
    userProfile,
    profileLoading,
    isAdmin,
    isTeamLeader,
    loadUserProfile,
    signInWithGoogle,
    signInWithEmail,
    signOut,
  }
}
