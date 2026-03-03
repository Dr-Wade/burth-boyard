import { ref, computed } from 'vue'
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useCurrentUser } from 'vuefire'
import { auth, googleProvider, db } from '../firebase'

const userProfile = ref(null)
const profileLoading = ref(false)

export function useAuth() {
  const user = useCurrentUser()

  const isAdmin = computed(() => userProfile.value?.role === 'admin')
  const isTeamLeader = computed(() => userProfile.value?.role === 'team-leader')

  async function loadUserProfile(uid) {
    profileLoading.value = true
    const snap = await getDoc(doc(db, 'users', uid))
    userProfile.value = snap.exists() ? { id: snap.id, ...snap.data() } : null
    profileLoading.value = false
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

  async function signOut() {
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
    signOut,
  }
}
