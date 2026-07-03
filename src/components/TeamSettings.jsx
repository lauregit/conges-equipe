import { useState } from 'react'
import { ROLES } from '../constants'

const ROLE_LABELS = { employee: 'Employé', manager: 'Manager', admin: 'Admin' }
const EMPTY = { name: '', email: '', team: 'Marketing', role: 'employee', active: true }

// Admin-only roster editor: emails (for notifications), teams, roles.
export default function TeamSettings({ employees, onSave }) {
  const [drafts, setDrafts] = useState({}) // id -> edited row
  const [newRow, setNewRow] = useState(EMPTY)
  const [busy, setBusy] = useState(null)

  const teams = [...new Set(employees.map(e => e.team))].sort()

  async function save(row, isNew = false) {
    setBusy(isNew ? 'new' : row.id)
    try {
      await onSave(row)
      if (isNew) setNewRow(EMPTY)
      else setDrafts(d => { const { [row.id]: _, ...rest } = d; return rest })
    } finally {
      setBusy(null)
    }
  }

  // Plain render helper (NOT a nested component — a nested component would be
  // recreated each render and inputs would lose focus on every keystroke).
  function renderRow(emp, isNew) {
    const row = isNew ? newRow : (drafts[emp.id] || emp)
    const set = isNew
      ? (field, value) => setNewRow(r => ({ ...r, [field]: value }))
      // Read the latest draft from the setter arg (not the render-time `row`
      // closure) so batched rapid edits can't overwrite each other.
      : (field, value) => setDrafts(d => ({ ...d, [emp.id]: { ...(d[emp.id] || emp), [field]: value } }))
    const dirty = isNew ? row.name.trim() !== '' : drafts[emp.id] !== undefined
    const who = row.name || 'la nouvelle personne'
    return (
      <div key={isNew ? '__new__' : emp.id} className={`team-row ${row.active === false ? 'team-row-inactive' : ''}`}>
        <input
          value={row.name}
          placeholder="Prénom NOM"
          onChange={e => set('name', e.target.value)}
          aria-label="Nom"
          disabled={!isNew}
        />
        <input
          type="email"
          value={row.email || ''}
          placeholder="email@certideal.com"
          onChange={e => set('email', e.target.value)}
          aria-label={`Email de ${who}`}
        />
        <input
          value={row.team}
          list="team-names"
          onChange={e => set('team', e.target.value)}
          aria-label={`Équipe de ${who}`}
        />
        <select
          value={row.role}
          onChange={e => set('role', e.target.value)}
          aria-label={`Rôle de ${who}`}
        >
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <label className="team-active">
          <input
            type="checkbox"
            checked={row.active !== false}
            onChange={e => set('active', e.target.checked)}
          />
          Actif
        </label>
        <button
          className="btn-primary"
          disabled={!dirty || busy === (isNew ? 'new' : emp.id)}
          onClick={() => save(row, isNew)}
        >
          {isNew ? '+ Ajouter' : 'Enregistrer'}
        </button>
      </div>
    )
  }

  return (
    <div className="team-container">
      <h2>Équipe & rôles</h2>
      <p className="team-hint">
        Les emails servent aux notifications (demande → managers de l'équipe + admins ;
        décision → demandeur). Les managers approuvent les demandes de leur équipe.
      </p>
      <datalist id="team-names">
        {teams.map(t => <option key={t} value={t} />)}
      </datalist>
      <div className="team-table">
        <div className="team-row team-row-head" aria-hidden="true">
          <span>Nom</span><span>Email</span><span>Équipe</span><span>Rôle</span><span></span><span></span>
        </div>
        {employees.map(emp => renderRow(emp, false))}
        {renderRow(EMPTY, true)}
      </div>
    </div>
  )
}
