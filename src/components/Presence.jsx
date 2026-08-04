import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { isDateInRange } from '../utils/dateHelpers'
import { TYPE_META } from '../constants'
import { sameName } from '../utils/names'

// Vue Présence : pour un jour donné, qui est présent / absent dans chaque équipe.
// `visibleTeams` est calculé par App.jsx :
//   employé → son équipe ; manager → ses équipes gérées (+ la sienne) ;
//   admin global → toutes les équipes.
export default function Presence({ employees, leaves, currentUser, visibleTeams = [], showFilter = false }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [teamFilter, setTeamFilter] = useState('')

  const active = employees.filter(e => e.active)
  const shownTeams = (teamFilter ? [teamFilter] : visibleTeams).filter(t => visibleTeams.includes(t))

  function statusFor(name) {
    const onLeave = leaves.find(l =>
      sameName(l.employee, name) && l.status === 'approved' && isDateInRange(date, l.startDate, l.endDate)
    )
    if (onLeave) return { kind: 'absent', leave: onLeave }
    const pending = leaves.find(l =>
      sameName(l.employee, name) && l.status === 'pending' && isDateInRange(date, l.startDate, l.endDate)
    )
    if (pending) return { kind: 'pending', leave: pending }
    return { kind: 'present' }
  }

  return (
    <div className="presence-container">
      <div className="presence-nav">
        <h2>Présence — {format(parseISO(date), 'EEEE d MMMM yyyy', { locale: fr })}</h2>
        <div className="presence-controls">
          <input
            type="date"
            value={date}
            onChange={e => e.target.value && setDate(e.target.value)}
            aria-label="Choisir la date"
          />
          {showFilter && visibleTeams.length > 1 && (
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} aria-label="Filtrer par équipe">
              <option value="">Toutes mes équipes</option>
              {visibleTeams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>

      {shownTeams.length === 0 && (
        <div className="no-leaves">Aucune équipe à afficher.</div>
      )}

      {shownTeams.map(team => {
        const members = active.filter(e => e.team === team)
        const stats = members.map(m => ({ ...m, ...statusFor(m.name) }))
        const absent = stats.filter(s => s.kind === 'absent').length
        return (
          <div key={team} className="presence-team">
            <h3>
              {team}
              <span className="presence-count">
                {members.length - absent}/{members.length} présent{members.length - absent > 1 ? 's' : ''}
              </span>
            </h3>
            <div className="presence-list">
              {stats.map(s => (
                <div key={s.name} className={`presence-item presence-${s.kind}`}>
                  <span className="presence-dot" aria-hidden="true">
                    {s.kind === 'present' ? '✓' : s.kind === 'absent' ? '✗' : '⏳'}
                  </span>
                  <span className="presence-name">
                    {sameName(s.name, currentUser) ? <strong>{s.name}</strong> : s.name}
                  </span>
                  <span className="presence-status">
                    {s.kind === 'present' && 'Présent'}
                    {s.kind === 'absent' && `Absent — ${TYPE_META[s.leave.type]?.label || s.leave.type}`}
                    {s.kind === 'pending' && `Demande en attente (${TYPE_META[s.leave.type]?.label || s.leave.type})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
