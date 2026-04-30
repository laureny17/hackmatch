// Shared channel for profile discovery
export const HACKMATCH_CHANNEL = 'hackmatch-26'

export const TRACKS = [
  'Fintech', 'Sustainability', 'Healthcare', 'Education',
  'Interactive Media', 'Applied AI'
]

export const FIELDS_OF_INTEREST = [
  'Systems', 'Hardware', 'AR/VR', 'Game Dev', 'Game Design',
  'Music', 'HCI', 'ML/AI', 'Research', 'UI/UX',
  'Web Dev', 'Mobile Dev', 'Data Science', 'Cybersecurity',
  'Robotics', 'Computer Vision', 'NLP', 'Embedded Systems',
  'Bioinformatics', 'Blockchain',
]

export const YEARS = ['First-Year', 'Sophomore', 'Junior', 'Senior']

export const PROFILE_QUESTIONS = [
  'What do you want to get out of the hackathon?',
  'What kind of project do you want to build?',
  'What skills would you bring to a team?',
]

// JSON Schema used by useGraffitiDiscover to filter profile objects
export const PROFILE_SCHEMA = {
  properties: {
    value: {
      required: ['activity', 'name', 'school', 'year', 'major', 'tracks', 'answers', 'status', 'describes', 'published'],
      properties: {
        activity:     { const: 'Profile' },
        name:         { type: 'object' },
        pronouns:     { type: 'string' },
        school:       { type: 'string' },
        year:         { type: 'string' },
        major:        { type: 'string' },
        tracks:       { type: 'array' },
        answers:      { type: 'object' },
        status:       { type: 'string' },
        confirmedTeammates: { type: 'array' },
        fieldsOfInterest: { type: 'array' },
        describes:    { type: 'string' },
        published:    { type: 'number' },
      },
    },
  },
}

// JSON Schema for teammate invite objects
export const TEAM_INVITE_SCHEMA = {
  properties: {
    value: {
      required: ['activity', 'from', 'to', 'published'],
      properties: {
        activity:         { const: 'TeamInvite' },
        from:             { type: 'string' },
        to:               { type: 'string' },
        fromTeam:         { type: 'array' },
        autoConfirmedBy:  { type: 'string' },
        published:        { type: 'number' },
      },
    },
  },
}

// JSON Schema for teammate decline/removal notifications
export const TEAM_DECLINE_SCHEMA = {
  properties: {
    value: {
      required: ['activity', 'from', 'to', 'published'],
      properties: {
        activity: { const: 'TeamDecline' },
        from:     { type: 'string' },
        to:       { type: 'string' },
        published: { type: 'number' },
      },
    },
  },
}

// JSON Schema for conversation creation objects
export const CONVERSATION_SCHEMA = {
  properties: {
    value: {
      required: ['activity', 'type', 'channel', 'participants', 'published'],
      properties: {
        activity:     { const: 'Create' },
        type:         { const: 'Conversation' },
        channel:      { type: 'string' },
        participants: { type: 'array' },
        participantKey: { type: 'string' },
        published:    { type: 'number' },
      },
    },
  },
}

// JSON Schema for message objects
export const MESSAGE_SCHEMA = {
  properties: {
    value: {
      required: ['content', 'published'],
      properties: {
        content:   { type: 'string' },
        published: { type: 'number' },
        channel:   { type: 'string' },
        attachment:{ type: 'object' },
        // optional: inReplyTo: { actorId, questionText, answerText }
      },
    },
  },
}

export function conversationPairKey(actorA, actorB) {
  return [actorA, actorB].sort().join('::')
}

export function conversationParticipantKey(participants = []) {
  return [...new Set(participants)].sort().join('::')
}

export function conversationParticipants(myActor, targetActor, teammates = []) {
  return conversationParticipantKey([myActor, targetActor, ...teammates])
    .split('::')
    .filter(Boolean)
}

export function conversationChannel(actorA, actorB) {
  return `hackmatch-conv:${[actorA, actorB].sort().map(encodeURIComponent).join(':')}`
}

// Avatar gradient palette (seeded by actor ID)
export const GRADIENTS = [
  'linear-gradient(135deg,#7C3AED,#DB2777)',
  'linear-gradient(135deg,#2563EB,#7C3AED)',
  'linear-gradient(135deg,#059669,#2563EB)',
  'linear-gradient(135deg,#D97706,#DC2626)',
  'linear-gradient(135deg,#BE185D,#7C3AED)',
  'linear-gradient(135deg,#0891B2,#059669)',
]

export function avatarGradient(str = '') {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % GRADIENTS.length
  return GRADIENTS[Math.abs(h)]
}

export function initials(profile) {
  if (!profile) return '?'
  const { name } = profile.value
  return ((name?.first?.[0] ?? '?') + (name?.last?.[0] ?? '')).toUpperCase()
}

// Track tag colour classes (cycles through 10 distinct pastel combos)
export const TRACK_COLORS = [
  'bg-violet  c-violet',
  'bg-pink    c-pink',
  'bg-green   c-green',
  'bg-amber   c-amber',
  'bg-blue    c-blue',
  'bg-red     c-red',
  'bg-gray    c-gray',
  'bg-teal    c-teal',
  'bg-orange  c-orange',
  'bg-lime    c-lime',
]
export function trackColor(trackName) {
  const idx = TRACKS.indexOf(trackName)
  return TRACK_COLORS[(idx >= 0 ? idx : 0) % TRACK_COLORS.length]
}

export function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (now - d < 7 * 24 * 60 * 60 * 1000)
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function formatDateLabel(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
