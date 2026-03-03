export const CHALLENGES = [
  {
    id: 'council-chamber',
    name: 'Council Chamber',
    summary: 'Face the riddles of the Council. Answer correctly to earn keys for the treasure room.',
    icon: '🗝️',
    maxTimeSeconds: 600,
    factors: ['timeSpent'],
  },
  {
    id: 'tigers-cage',
    name: "Tiger's Cage",
    summary: 'Retrieve the key from the cage before the tigers close in. Speed and courage are essential.',
    icon: '🐅',
    maxTimeSeconds: 600,
    factors: ['timeSpent'],
  },
  {
    id: 'treasure-room',
    name: 'Treasure Room',
    summary: 'Collect as many gold coins as possible before being locked inside the treasure room.',
    icon: '💰',
    maxTimeSeconds: 600,
    factors: ['timeSpent', 'targetsHit'],
  },
  {
    id: 'water-dungeon',
    name: 'Water Dungeon',
    summary: 'Navigate the underwater maze to retrieve the clue. Hold your breath and stay focused.',
    icon: '🌊',
    maxTimeSeconds: 600,
    factors: ['timeSpent'],
  },
  {
    id: 'balance-beam',
    name: 'Balance Beam',
    summary: 'Cross the beam over the void without falling. Each successful crossing earns bonus points.',
    icon: '⚖️',
    maxTimeSeconds: 600,
    factors: ['timeSpent', 'targetsHit'],
  },
  {
    id: 'cannonball-alley',
    name: 'Cannonball Alley',
    summary: 'Dodge cannonballs while hitting targets at the end of the alley. Accuracy matters!',
    icon: '💣',
    maxTimeSeconds: 600,
    factors: ['timeSpent', 'targetsHit'],
  },
  {
    id: 'dark-labyrinth',
    name: 'Dark Labyrinth',
    summary: 'Find your way through the pitch-black labyrinth. Only the fastest escape earns top marks.',
    icon: '🌑',
    maxTimeSeconds: 600,
    factors: ['timeSpent'],
  },
  {
    id: 'climbing-wall',
    name: 'Climbing Wall',
    summary: 'Scale the fortress wall to retrieve the flag at the top. Speed is everything.',
    icon: '🧗',
    maxTimeSeconds: 600,
    factors: ['timeSpent'],
  },
]

export function getChallengeById(id) {
  return CHALLENGES.find((c) => c.id === id) ?? null
}
