// Shared app constants — used by both the frontend and the API functions
// (the API imports from ../src/ so validation and UI can never drift).

export const LEAVE_TYPES = ['conge_paye', 'rtt', 'maladie', 'autre']

// Types that are DECLARED (auto-approved, managers notified for information)
// rather than REQUESTED (pending until a manager approves).
export const DECLARED_TYPES = ['maladie']

export const TYPE_META = {
  conge_paye: { label: 'Congé payé', emoji: '🏖️', short: 'CP', bg: '#bfdbfe' },
  rtt: { label: 'RTT', emoji: '⚡', short: 'RTT', bg: '#d9f99d' },
  maladie: { label: 'Maladie', emoji: '🤒', short: '🤒', bg: '#fecaca' },
  autre: { label: 'Autre', emoji: '📋', short: '...', bg: '#e9d5ff' },
}

export const ROLES = ['employee', 'manager', 'admin']
