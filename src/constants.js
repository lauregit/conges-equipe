// Shared app constants — used by both the frontend and the API functions
// (the API imports from ../src/ so validation and UI can never drift).

export const LEAVE_TYPES = ['conge_paye', 'conge_sans_solde', 'teletravail', 'arret_maladie']

// Types that are DECLARED (auto-approved, managers notified for information)
// rather than REQUESTED (pending until a manager approves).
export const DECLARED_TYPES = ['arret_maladie']

export const TYPE_META = {
  conge_paye:       { label: 'Congé payé',      emoji: '🏖️', short: 'CP',  bg: '#bfdbfe' },
  conge_sans_solde: { label: 'Congé sans solde', emoji: '💸', short: 'CSS', bg: '#fed7aa' },
  teletravail:      { label: 'TT / À distance',  emoji: '🏠', short: '🏠',  bg: '#d9f99d' },
  arret_maladie:    { label: 'Arrêt maladie',    emoji: '🤒', short: '🤒',  bg: '#fecaca' },
}

export const ROLES = ['employee', 'manager', 'admin']
