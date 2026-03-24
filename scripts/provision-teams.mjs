import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  limit,
  getDocs,
  setDoc,
} from 'firebase/firestore'

import codes from '../resources/mot-codes.js'
import { CHALLENGES } from '../src/data/challenges.js'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function normalizeAdminEmail(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return value
  return value.includes('@') ? value : `${value}@burth-boyard.app`
}

const firebaseConfig = {
  apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv('VITE_FIREBASE_APP_ID'),
}

const adminUsername =
  process.env.FIREBASE_ADMIN_USERNAME ??
  process.env.FIREBASE_ADMIN_EMAIL ??
  process.env.ADMIN_USERNAME ??
  process.env.ADMIN_EMAIL

if (!adminUsername) {
  throw new Error(
    'Missing admin username/email env var. Use one of: FIREBASE_ADMIN_USERNAME, FIREBASE_ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_EMAIL.',
  )
}

const adminPassword =
  process.env.FIREBASE_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD

if (!adminPassword) {
  throw new Error(
    'Missing admin password env var. Use FIREBASE_ADMIN_PASSWORD or ADMIN_PASSWORD.',
  )
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const functions = getFunctions(app, 'europe-west1')

const createUser = httpsCallable(functions, 'createUser')

async function findUserUidByEmail(email) {
  const snap = await getDocs(
    query(collection(db, 'users'), where('email', '==', email), limit(1)),
  )
  if (snap.empty) return null
  return snap.docs[0].id
}

async function provisionTeam(teamCode) {
  const teamId = teamCode.team
  const leaderEmail = `${teamId}@burth-boyard.app`
  const teamName = teamCode.name ?? teamId
  const displayName = teamCode.displayName ?? teamName

  let leaderUid = null

  try {
    const { data } = await createUser({
      username: leaderEmail,
      password: teamCode.password,
      displayName: teamName,
      role: 'team-leader',
    })
    leaderUid = data.uid
    console.log(`Created leader user for ${teamId}: ${leaderEmail}`)
  } catch (error) {
    const message = String(error?.message ?? '').toLowerCase()
    if (message.includes('already') || message.includes('exists')) {
      leaderUid = await findUserUidByEmail(leaderEmail)
      if (!leaderUid) {
        throw new Error(
          `Leader already exists for ${teamId}, but could not resolve uid from users collection (${leaderEmail}).`,
        )
      }
      console.log(`Leader already exists for ${teamId}, reusing user ${leaderUid}`)
    } else {
      throw error
    }
  }

  await setDoc(
    doc(db, 'teams', teamId),
    {
      name: teamName,
      displayName,
      leaderUid,
      finalHints: teamCode.hints,
      finalSecretWord: teamCode.answer,
      totalScore: 0,
      createdAt: new Date(),
    },
    { merge: true },
  )

  for (const challenge of CHALLENGES) {
    await setDoc(
      doc(db, 'teams', teamId, 'challenges', challenge.id),
      {
        teamId,
        challengeId: challenge.id,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        failed: false,
        score: 0,
        factors: {},
      },
      { merge: true },
    )
  }

  await setDoc(
    doc(db, 'users', leaderUid),
    {
      displayName: teamName,
      email: leaderEmail,
      role: 'team-leader',
      teamId,
    },
    { merge: true },
  )

  console.log(`Upserted /teams/${teamId} with leader ${leaderUid}`)
}

async function main() {
  const adminEmail = normalizeAdminEmail(adminUsername)
  await signInWithEmailAndPassword(auth, adminEmail, adminPassword)
  console.log(`Signed in as admin: ${adminEmail}`)

  for (const teamCode of codes) {
    await provisionTeam(teamCode)
  }

  console.log('Done provisioning all teams.')
}

main().catch((error) => {
  console.error('Provisioning failed:', error)
  process.exit(1)
})
