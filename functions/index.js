const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { setGlobalOptions } = require('firebase-functions')

initializeApp()
const minInstances = process.env.FUNCTIONS_MIN_INSTANCES === '1' ? 1 : 0
setGlobalOptions({ region: 'europe-west1', minInstances })
const db = getFirestore()
const adminAuth = getAuth()

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------
const TIME_MULTIPLIER = 13        // points per remaining second (1/10th precision)
const COMPLETION_BONUS = 1_000    // flat bonus for completing a challenge
const MAX_POINTS_PER_FACTOR = 500 // cap per scoring factor (time or targets)
const GUESS_BONUS = 10_000        // bonus for guessing the secret word
const HINT_COST = 4_000           // cost per additional hint purchase
const MAX_BOUGHT_HINTS = 6        // max purchasable hints
const TIMEOUT_PENALTY = -500      // penalty when challenge fails due to time running out

function normalizeWord(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Score calculation
// failed=true: skip completion bonus and time score, only award targets
// ---------------------------------------------------------------------------
function calculateScoreFromFactors({ factors, challengeDef, failed = false }) {
  let score = failed ? 0 : COMPLETION_BONUS

  const maxTime = factors.maxTimeSeconds ?? challengeDef.maxTimeSeconds ?? 600
  const timeSpent = factors.timeSpent ?? maxTime

  if (!failed && challengeDef.factors.includes('timeSpent')) {
    const remaining = Math.max(0, maxTime - timeSpent)
    const timeScore = Math.min(MAX_POINTS_PER_FACTOR, Math.round(remaining * TIME_MULTIPLIER))
    score += timeScore
  }

  if (challengeDef.factors.includes('targetsHit')) {
    const maxTargets = challengeDef.maxTargets ?? 1
    const targetsHit = factors.targetsHit ?? 0
    const perTarget = Math.round(MAX_POINTS_PER_FACTOR / maxTargets)
    const targetScore = Math.min(MAX_POINTS_PER_FACTOR, targetsHit * perTarget)
    score += targetScore
  }

  return score
}

// ---------------------------------------------------------------------------
// Challenge definitions (mirrored from client for validation)
// ---------------------------------------------------------------------------
const CHALLENGES = {
  'père-fouras':          { maxTimeSeconds: 600, maxTargets: 5, factors: ['targetsHit'] },
  'conseil':              { maxTimeSeconds: 600, maxTargets: 3, factors: ['targetsHit'] },
  'puzzle':               { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'esquif':               { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'blanche':              { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'tir-arc':              { maxTimeSeconds: 600, maxTargets: 3, factors: ['timeSpent', 'targetsHit'] },
  'cache-clé':            { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'roi-du-silence':       { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'mains-chercheuses':    { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'carrés-fluoerscents':  { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'cuisine':              { maxTimeSeconds: 600, factors: ['timeSpent'] },
  'rouge':                { maxTimeSeconds: 600, factors: ['timeSpent'] },
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

  const score = calculateScoreFromFactors({ factors, challengeDef })

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

    const wasAlreadyCompleted = challengeQuery.docs[0].data().status === 'completed'

    tx.update(challengeDocRef, {
      status: 'completed',
      completedAt: new Date(),
      score,
      factors,
      failed: false,
    })

    tx.update(teamRef, {
      totalScore: (teamSnap.data().totalScore ?? 0) + scoreDiff,
      completedChallenges: (teamSnap.data().completedChallenges ?? 0) + (wasAlreadyCompleted ? 0 : 1),
    })
  })

  return { score }
})

// ---------------------------------------------------------------------------
// Cloud Function: markFailed
// Called client-side when a challenge timer expires or the team manually fails.
// Awards partial points for targetsHit (if any), no completion bonus, no time.
// ---------------------------------------------------------------------------
exports.markFailed = onCall(async (request) => {
  const { teamId, challengeId, factors, timedOut } = request.data
  if (!teamId || !challengeId) {
    throw new HttpsError('invalid-argument', 'Missing teamId or challengeId.')
  }

  const challengeDef = CHALLENGES[challengeId]
  if (!challengeDef) {
    throw new HttpsError('not-found', `Unknown challenge: ${challengeId}`)
  }

  let score = calculateScoreFromFactors({ factors: factors ?? {}, challengeDef, failed: true })
  if (timedOut) score += TIMEOUT_PENALTY

  const teamRef = db.collection('teams').doc(teamId)
  const challengeQuery = await db
    .collection('teams').doc(teamId).collection('challenges')
    .where('challengeId', '==', challengeId).limit(1).get()

  if (challengeQuery.empty) {
    throw new HttpsError('not-found', `Challenge doc for ${challengeId} not found.`)
  }

  const challengeDocRef = challengeQuery.docs[0].ref
  const prevScore = challengeQuery.docs[0].data().score ?? 0

  await db.runTransaction(async (tx) => {
    const teamSnap = await tx.get(teamRef)
    if (!teamSnap.exists) throw new HttpsError('not-found', `Team ${teamId} not found.`)
    const scoreDiff = score - prevScore
    tx.update(challengeDocRef, {
      status: 'failed',
      failed: true,
      timedOut: !!timedOut,
      completedAt: new Date(),
      score,
      factors: factors ?? {},
    })
    tx.update(teamRef, {
      totalScore: (teamSnap.data().totalScore ?? 0) + scoreDiff,
    })
  })

  return { score }
})

// ---------------------------------------------------------------------------
// Challenge IDs list — fixed canonical order, teams start at different offsets
// ---------------------------------------------------------------------------
const CHALLENGE_IDS = Object.keys(CHALLENGES)

// Generate cycling orders: each team gets the same order but starting at a
// different position so every team faces a unique challenge at each round.
function generateChallengeOrders(teamCount) {
  const orders = []
  for (let i = 0; i < teamCount; i++) {
    const offset = i % CHALLENGE_IDS.length
    const rotated = [...CHALLENGE_IDS.slice(offset), ...CHALLENGE_IDS.slice(0, offset)]
    orders.push(rotated)
  }
  return orders
}

const DEFAULT_ROUND_DURATION_MINUTES = 15
const FINAL_PHASE_DURATION_MS = 5 * 60 * 1000  // 5 minutes for final word-guess phase

function getRoundDurationMs(gameData) {
  const minutes = gameData?.roundDurationMinutes ?? DEFAULT_ROUND_DURATION_MINUTES
  return minutes * 60 * 1000
}

// ---------------------------------------------------------------------------
// Cloud Function: startGame
// Called by admin to start the game. Shuffles challenge order per team.
// ---------------------------------------------------------------------------
exports.startGame = onCall(async (request) => {
  const gameRef = db.collection('games').doc('current')
  const teamsSnap = await db.collection('teams').get()

  if (teamsSnap.empty) {
    throw new HttpsError('failed-precondition', 'No teams registered.')
  }

  const teamDocs = teamsSnap.docs
  const orders = generateChallengeOrders(teamDocs.length)
  const now = new Date()

  const batch = db.batch()

  // Assign challenge order to each team
  teamDocs.forEach((teamDoc, idx) => {
    batch.update(teamDoc.ref, { challengeOrder: orders[idx] })
  })

  const roundDurationMinutes = request.data?.roundDurationMinutes ?? DEFAULT_ROUND_DURATION_MINUTES

  // Set game state
  batch.set(gameRef, {
    status: 'active',
    currentRound: 0,
    totalRounds: CHALLENGE_IDS.length,
    startedAt: now,
    roundStartedAt: now,
    roundDurationMinutes,
  })

  await batch.commit()

  return { success: true, totalRounds: CHALLENGE_IDS.length, teamsCount: teamDocs.length }
})

// ---------------------------------------------------------------------------
// Cloud Function: advanceRound
// Called by admin or by the scheduler to move to the next round.
// ---------------------------------------------------------------------------
async function doAdvanceRound(options = {}) {
  const { expectedCurrentRound = null, expectedRoundStartedAtMs = null } = options
  const gameRef = db.collection('games').doc('current')
  return db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef)

    if (!gameSnap.exists || gameSnap.data().status !== 'active') {
      return { advanced: false, reason: 'Game not active' }
    }

    const data = gameSnap.data()
    const currentRound = data.currentRound ?? 0

    if (expectedCurrentRound !== null && currentRound !== expectedCurrentRound) {
      return { advanced: false, reason: 'Stale round trigger' }
    }

    if (expectedRoundStartedAtMs !== null) {
      const roundStartedAt = data.roundStartedAt?.toDate
        ? data.roundStartedAt.toDate()
        : new Date(data.roundStartedAt)
      if (roundStartedAt.getTime() !== expectedRoundStartedAtMs) {
        return { advanced: false, reason: 'Stale round start trigger' }
      }
    }

    const nextRound = currentRound + 1
    const roundDurationMinutes = data.roundDurationMinutes ?? DEFAULT_ROUND_DURATION_MINUTES

    if (nextRound >= (data.totalRounds ?? CHALLENGE_IDS.length)) {
      // Transition to final word-guess phase instead of finished
      tx.update(gameRef, {
        status: 'final',
        finalStartedAt: new Date(),
      })
      return { advanced: true, final: true }
    }

    tx.update(gameRef, {
      currentRound: nextRound,
      roundStartedAt: new Date(),
      roundDurationMinutes,
    })
    return { advanced: true, currentRound: nextRound }
  })
}

exports.advanceRound = onCall(async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.')

  const callerSnap = await db.collection('users').doc(callerUid).get()
  if (!callerSnap.exists || callerSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can advance the round manually.')
  }

  return await doAdvanceRound()
})

// ---------------------------------------------------------------------------
// Cloud Function: autoAdvanceIfElapsed
// Low-latency trigger callable by any signed-in user.
// Advances round only when active round duration has actually elapsed.
// ---------------------------------------------------------------------------
exports.autoAdvanceIfElapsed = onCall(async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.')

  const gameRef = db.collection('games').doc('current')
  const gameSnap = await gameRef.get()
  if (!gameSnap.exists) {
    return { advanced: false, reason: 'Game not found' }
  }

  const data = gameSnap.data()
  if (data.status !== 'active' || !data.roundStartedAt) {
    return { advanced: false, reason: 'Game not active' }
  }

  const roundStart = data.roundStartedAt.toDate()
  const elapsed = Date.now() - roundStart.getTime()
  const roundDurationMs = getRoundDurationMs(data)

  if (elapsed < roundDurationMs) {
    return { advanced: false, reason: 'Round not elapsed', remainingMs: roundDurationMs - elapsed }
  }

  return await doAdvanceRound({
    expectedCurrentRound: data.currentRound ?? 0,
    expectedRoundStartedAtMs: roundStart.getTime(),
  })
})

// ---------------------------------------------------------------------------
// Cloud Function: pauseGame
// Called by admin to pause the game (preserves remaining time).
// ---------------------------------------------------------------------------
exports.pauseGame = onCall(async () => {
  const gameRef = db.collection('games').doc('current')
  const gameSnap = await gameRef.get()
  if (!gameSnap.exists || gameSnap.data().status !== 'active') {
    throw new HttpsError('failed-precondition', 'Game is not active.')
  }
  const data = gameSnap.data()
  const roundStart = data.roundStartedAt.toDate()
  const elapsed = Date.now() - roundStart.getTime()
  const remainingMs = Math.max(0, getRoundDurationMs(data) - elapsed)
  await gameRef.update({ status: 'paused', pausedRemainingMs: remainingMs })
  return { success: true, remainingMs }
})

// ---------------------------------------------------------------------------
// Cloud Function: resumeGame
// Called by admin to resume a paused game (restores remaining time).
// ---------------------------------------------------------------------------
exports.resumeGame = onCall(async () => {
  const gameRef = db.collection('games').doc('current')
  const gameSnap = await gameRef.get()
  if (!gameSnap.exists || gameSnap.data().status !== 'paused') {
    throw new HttpsError('failed-precondition', 'Game is not paused.')
  }
  const data = gameSnap.data()
  const roundDurationMs = getRoundDurationMs(data)
  const remainingMs = data.pausedRemainingMs ?? roundDurationMs
  // Compute a synthetic roundStartedAt so that remaining time is preserved
  const syntheticStart = new Date(Date.now() - (roundDurationMs - remainingMs))
  await gameRef.update({ status: 'active', roundStartedAt: syntheticStart, pausedRemainingMs: null })
  return { success: true }
})

// ---------------------------------------------------------------------------
// Cloud Function: jumpToStep
// Called by admin to jump directly to a specific round (0-indexed).
// ---------------------------------------------------------------------------
exports.jumpToStep = onCall(async (request) => {
  const { step } = request.data
  if (typeof step !== 'number' || step < 0) {
    throw new HttpsError('invalid-argument', 'step must be a non-negative number.')
  }
  const gameRef = db.collection('games').doc('current')
  const gameSnap = await gameRef.get()
  if (!gameSnap.exists) {
    throw new HttpsError('not-found', 'Game not found.')
  }
  const data = gameSnap.data()
  const totalRounds = data.totalRounds ?? CHALLENGE_IDS.length
  const targetStep = Math.min(step, totalRounds - 1)
  await gameRef.update({
    status: 'active',
    currentRound: targetStep,
    roundStartedAt: new Date(),
    pausedRemainingMs: null,
  })
  return { success: true, currentRound: targetStep }
})

// ---------------------------------------------------------------------------
// Cloud Function: endGame
// Called by admin to end the game immediately.
// ---------------------------------------------------------------------------
exports.endGame = onCall(async () => {
  const gameRef = db.collection('games').doc('current')
  await gameRef.update({ status: 'finished' })
  return { success: true }
})

// ---------------------------------------------------------------------------
// Cloud Function: setFinalPhase
// Admin: set per-team secret word and hints.
// ---------------------------------------------------------------------------
exports.setFinalPhase = onCall(async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.')
  const callerSnap = await db.collection('users').doc(callerUid).get()
  if (!callerSnap.exists || callerSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admins only.')
  }

  // teamConfigs: [{ teamId, secretWord, hints[] }]
  const { teamConfigs } = request.data
  if (!Array.isArray(teamConfigs) || teamConfigs.length === 0) {
    throw new HttpsError('invalid-argument', 'teamConfigs[] required.')
  }

  const batch = db.batch()
  for (const cfg of teamConfigs) {
    if (!cfg.teamId || !cfg.secretWord || !Array.isArray(cfg.hints)) continue
    batch.update(db.collection('teams').doc(cfg.teamId), {
      finalSecretWord: cfg.secretWord,
      finalHints: cfg.hints,
    })
  }
  await batch.commit()
  return { success: true }
})

// ---------------------------------------------------------------------------
// Cloud Function: buyHint
// Team purchases an additional hint for HINT_COST points.
// ---------------------------------------------------------------------------
exports.buyHint = onCall(async (request) => {
  const { teamId } = request.data
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId required.')

  const gameRef = db.collection('games').doc('current')
  const teamRef = db.collection('teams').doc(teamId)

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef)
    const teamSnap = await tx.get(teamRef)

    if (!gameSnap.exists || gameSnap.data().status !== 'final') {
      throw new HttpsError('failed-precondition', 'Game is not in final phase.')
    }
    if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.')

    const teamData = teamSnap.data()
    const boughtHints = teamData.boughtHints ?? 0
    if (boughtHints >= MAX_BOUGHT_HINTS) {
      throw new HttpsError('failed-precondition', 'Maximum hints already purchased.')
    }

    const currentScore = teamData.totalScore ?? 0
    if (currentScore < HINT_COST) {
      throw new HttpsError('failed-precondition', 'Not enough points to buy a hint.')
    }

    tx.update(teamRef, {
      totalScore: currentScore - HINT_COST,
      boughtHints: boughtHints + 1,
    })
  })

  return { success: true }
})

// ---------------------------------------------------------------------------
// Cloud Function: submitGuess
// Team submits one guess for the secret word. One attempt only.
// ---------------------------------------------------------------------------
exports.submitGuess = onCall(async (request) => {
  const { teamId, guess } = request.data
  if (!teamId || !guess) throw new HttpsError('invalid-argument', 'teamId and guess required.')

  const gameRef = db.collection('games').doc('current')
  const teamRef = db.collection('teams').doc(teamId)

  let correct = false

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef)
    const teamSnap = await tx.get(teamRef)

    const gameStatus = gameSnap.exists ? gameSnap.data().status : null
    if (gameStatus !== 'final') {
      const reason = gameStatus === 'finished'
        ? 'Le temps est écoulé, plus aucune réponse acceptée.'
        : 'Game is not in final phase.'
      throw new HttpsError('failed-precondition', reason)
    }
    if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.')

    const teamData = teamSnap.data()
    if (teamData.hasGuessed) {
      throw new HttpsError('failed-precondition', 'Team has already submitted a guess.')
    }

    const secretWord = normalizeWord(teamData.finalSecretWord)
    if (!secretWord) throw new HttpsError('failed-precondition', 'No secret word configured for this team.')
    correct = normalizeWord(guess) === secretWord

    tx.update(teamRef, {
      hasGuessed: true,
      guess: guess.trim(),
      guessCorrect: correct,
      totalScore: (teamData.totalScore ?? 0) + (correct ? GUESS_BONUS : 0),
    })
  })

  return { correct, bonus: correct ? GUESS_BONUS : 0 }
})

// ---------------------------------------------------------------------------
// Cloud Function: autoEndFinalIfElapsed
// Called client-side when the final phase timer hits zero.
// Transitions game from 'final' to 'finished' if time has truly elapsed.
// ---------------------------------------------------------------------------
exports.autoEndFinalIfElapsed = onCall(async (request) => {
  const gameRef = db.collection('games').doc('current')
  const gameSnap = await gameRef.get()

  if (!gameSnap.exists || gameSnap.data().status !== 'final') {
    return { ended: false, reason: 'Not in final phase' }
  }

  const data = gameSnap.data()
  const finalStartedAt = data.finalStartedAt?.toDate
    ? data.finalStartedAt.toDate()
    : new Date(data.finalStartedAt)
  const elapsed = Date.now() - finalStartedAt.getTime()

  if (elapsed < FINAL_PHASE_DURATION_MS) {
    return { ended: false, reason: 'Final phase not elapsed', remainingMs: FINAL_PHASE_DURATION_MS - elapsed }
  }

  await gameRef.update({ status: 'finished' })
  return { ended: true }
})

// ---------------------------------------------------------------------------
// Cloud Function: resetGame
// Resets game to waiting, wipes all team scores, clears all challenge results.
// ---------------------------------------------------------------------------
exports.resetGame = onCall(async () => {
  const gameRef = db.collection('games').doc('current')
  const teamsSnap = await db.collection('teams').get()

  const batch = db.batch()

  // Reset each team
  for (const teamDoc of teamsSnap.docs) {
    batch.update(teamDoc.ref, {
      totalScore: 0,
      completedChallenges: 0,
      challengeOrder: [],
      boughtHints: 0,
      hasGuessed: false,
      guess: null,
      guessCorrect: false,
    })

    // Reset all challenge docs in subcollection
    const challengesSnap = await db.collection('teams').doc(teamDoc.id).collection('challenges').get()
    for (const chDoc of challengesSnap.docs) {
      batch.update(chDoc.ref, {
        status: 'pending',
        score: 0,
        factors: {},
        failed: false,
        startedAt: null,
        completedAt: null,
      })
    }
  }

  batch.set(gameRef, { status: 'waiting' })

  await batch.commit()
  return { success: true }
})

// ---------------------------------------------------------------------------
// Scheduled Function: autoAdvanceRound
// Runs every minute. If 15 minutes have passed since roundStartedAt, advance.
// ---------------------------------------------------------------------------
exports.autoAdvanceRound = onSchedule('every 1 minutes', async () => {
  const gameRef = db.collection('games').doc('current')
  const gameSnap = await gameRef.get()

  if (!gameSnap.exists || gameSnap.data().status !== 'active') return

  const data = gameSnap.data()
  if (!data.roundStartedAt) return

  const roundStart = data.roundStartedAt.toDate()
  const elapsed = Date.now() - roundStart.getTime()

  const roundDurationMs = getRoundDurationMs(data)
  if (elapsed >= roundDurationMs) {
    const result = await doAdvanceRound({
      expectedCurrentRound: data.currentRound ?? 0,
      expectedRoundStartedAtMs: roundStart.getTime(),
    })
    if (result.advanced) {
      console.log(`Auto-advanced to round ${(data.currentRound ?? 0) + 1}`)
    }
  }
})

// ---------------------------------------------------------------------------
// Cloud Function: createUser
// Admin-only. Creates a Firebase Auth user + Firestore profile.
// Username (no @) gets @burth-boyard.app appended automatically.
// ---------------------------------------------------------------------------
exports.createUser = onCall(async (request) => {
  // Verify caller is admin
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.')
  const callerSnap = await db.collection('users').doc(callerUid).get()
  if (!callerSnap.exists || callerSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can create users.')
  }

  const { username, password, displayName, role } = request.data
  if (!username || !password || !displayName) {
    throw new HttpsError('invalid-argument', 'username, password and displayName are required.')
  }

  const email = username.includes('@') ? username : `${username}@burth-boyard.app`

  // Create Firebase Auth user
  const authUser = await adminAuth.createUser({ email, password, displayName })

  // Create Firestore profile
  await db.collection('users').doc(authUser.uid).set({
    displayName,
    email,
    role: role ?? null,
    teamId: null,
    createdAt: new Date(),
  })

  return { uid: authUser.uid, email }
})

// ---------------------------------------------------------------------------
// Cloud Function: deleteUser
// Admin-only. Deletes Firebase Auth user + Firestore profile.
// Also clears teams/{teamId}.leaderUid when the deleted user was a team leader.
// ---------------------------------------------------------------------------
exports.deleteUser = onCall(async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.')

  const callerSnap = await db.collection('users').doc(callerUid).get()
  if (!callerSnap.exists || callerSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can delete users.')
  }

  const { userId } = request.data ?? {}
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required.')
  if (userId === callerUid) {
    throw new HttpsError('failed-precondition', 'You cannot delete your own account.')
  }

  const userRef = db.collection('users').doc(userId)
  const userSnap = await userRef.get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found.')
  }

  const userData = userSnap.data() || {}
  const teamId = userData.teamId
  const role = userData.role

  if (role === 'team-leader' && teamId) {
    await db.collection('teams').doc(teamId).update({ leaderUid: null })
  }

  await userRef.delete()
  await adminAuth.deleteUser(userId)

  return { success: true }
})
