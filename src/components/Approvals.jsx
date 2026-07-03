import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { TYPE_META } from '../constants'

// Pending-request queue for managers (their team) and admins (everyone).
export default function Approvals({ employees, leaves, currentUser, onDecide }) {
  const [busy, setBusy] = useState(null) // leave id being processed
  const me = employees.find(e => e.name === currentUser)
  const isAdmin = me?.role === 'admin'

  const teamOf = name => employees.find(e => e.name === name)?.team

  const pending = leaves.filter(l =>
    l.status === 'pending' &&
    // explicit `me` guard: a user absent from the roster must see nothing
    (isAdmin || (me && teamOf(l.employee) === me.team)) &&
    (isAdmin || l.employee !== currentUser) // managers never decide their own
  )

  async function decide(id, action) {
    setBusy(id)
    try {
      await onDecide(id, action)
    } finally {
      setBusy(null)
    }
  }

  function fmtRange(l) {
    return l.startDate === l.endDate
      ? format(parseISO(l.startDate), 'd MMMM yyyy', { locale: fr })
      : `${format(parseISO(l.startDate), 'd MMM', { locale: fr })} → ${format(parseISO(l.endDate), 'd MMM yyyy', { locale: fr })}`
  }

  return (
    <div className="approvals-container">
      <h2>Demandes à traiter {pending.length > 0 && <span className="badge">{pending.length}</span>}</h2>
      {pending.length === 0 ? (
        <div className="no-leaves">🎉 Aucune demande en attente.</div>
      ) : (
        <div className="leave-list">
          {pending.map(l => (
            <div key={l.id} className="leave-item approval-item">
              <div className="leave-item-info">
                <span className="leave-item-name">
                  {l.employee}
                  <span className="team-tag">{teamOf(l.employee) || '—'}</span>
                </span>
                <span className="leave-item-dates">
                  {TYPE_META[l.type]?.emoji} {TYPE_META[l.type]?.label || l.type} · {fmtRange(l)}
                  {l.note && <> · {l.note}</>}
                </span>
              </div>
              <div className="approval-actions">
                <button
                  className="btn-approve"
                  disabled={busy === l.id}
                  onClick={() => decide(l.id, 'approve')}
                  aria-label={`Approuver la demande de ${l.employee}`}
                >
                  ✓ Approuver
                </button>
                <button
                  className="btn-reject"
                  disabled={busy === l.id}
                  onClick={() => decide(l.id, 'reject')}
                  aria-label={`Refuser la demande de ${l.employee}`}
                >
                  ✗ Refuser
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
