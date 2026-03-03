const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

initializeApp()
const db = getFirestore()

// ---------------------------------------------------------------------------
// Modular score calculators — one per challenge type.
// Each receives { factors, challengeDef } and returns a numeric score.
// Add / override entries here when specifying custom logic per challenge.
// ---------------------------------------------------------------------------
const scoreCalculators = {
  // Default: pure time-based scoring
  // Faster completion → higher score. Max 1000 pts at 0 s, min 100 pts.
  default({ factors, challengeDef }) {
    const maxTime = challengeDef.maxTimeSeconds ?? 600
    const timeSpent = factors.timeSpent ?? maxTime
    const ratio = 1 - timeSpent / maxTime
    return Math.max(100, Math.round(ratio * 1000))
  },

  // Challenges with targets: combine time + accuracy
  // 60 % weight on targets, 40 % weight on speed
  withTargets({ factors, challengeDef }) {
    const maxTime = challengeDef.maxTimeSeconds ?? 600
    const timeSpent = factors.timeSpent ?? maxTime
    const targetsHit = factors.targetsHit ?? 0

    const timeRatio = 1 - timeSpent / maxTime
    const timeScore = Math.max(0, Math.round(timeRatio * 400)) // max 400
    const targetScore = targetsHit * 60 // 60 pts per target

    return timeScore + targetScore
  },
}

// Map challenge IDs to their calculator key.
// Challenges not listed here fall back to "default".
const challengeCalculatorMap = {
  'treasure-room': 'withTargets',
  'balance-beam': 'withTargets',
  'cannonball-alley': 'withTargets',
}

// Challenge definitions (mirrored from client for validation)
const CHALLENGES = {
  'council-chamber': { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'tigers-cage': { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'treasure-room': { maxTimeSeconds: 600, factors: ['timeSpent', 'targetsHit'] },
  'water-dungeon': { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'balance-beam': { maxTimeSeconds: 600, factors: ['timeSpent', 'targetsHit'] },
  'cannonball-alley': { maxTimeSeconds: 600, factors: ['timeSpent', 'targetsHit'] },
  'dark-labyrinth': { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'climbing-wall': { maxTimeSeconds: 600, factors: ['timeSpent'] },
}

// ---------------------------------------------------------------------------
// Cloud Function: calculateScore
// Called by the client when a challenge is completed successfully.
// Writes to the subcollection: teams/{teamId}/challenges/{docId}
// ---------------------------------------------------------------------------
exports.calculateScore = onCall(async (request) => {
  const { teamId, challengeId, factors } = request.data

  if (!teamId || !challengeId || !factors) {
    throw new HttpsError('invalid-argument', 'Missing teamId, challengeId, or factors.')
  }

  const challengeDef = CHALLENGES[challengeId]
  if (!challengeDef) {
    throw new HttpsError('not-found', `Unknown challenge: ${challengeId}`)
  }

  // Pick the right calculator
  const calculatorKey = challengeCalculatorMap[challengeId] ?? 'default'
  const calculate = scoreCalculators[calculatorKey]
  const score = calculate({ factors, challengeDef })

  const teamRef = db.collection('teams').doc(teamId)

  // Find the challenge doc in the subcollection
  const challengeQuery = await db
    .collection('teams')
    .doc(teamId)
    .collection('challenges')
    .where('challengeId', '==', challengeId)
    .limit(1)
    .get()

  if (challengeQuery.empty) {
    throw new HttpsError('not-found', `Challenge doc for ${challengeId} not found in subcollection.`)
  }

  const challengeDocRef = challengeQuery.docs[0].ref
  const prevScore = challengeQuery.docs[0].data().score ?? 0

  await db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef)
    if (!teamSnap.exists) {
      throw new HttpsError('not-found', `Team ${teamId} not found.`)
    }

    const scoreDiff = score - prevScore

    tx.update(challengeDocRef, {
      status: 'completed',
      completedAt: new Date(),
      score,
      factors,
      failed: false,
    })

    tx.update(teamRef, {
      totalScore: (teamSnap.data().totalScore ?? 0) + scoreDiff,
    })
  })

  return { score }
})
