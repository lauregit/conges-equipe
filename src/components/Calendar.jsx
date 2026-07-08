import { useState } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, addMonths, subMonths,
  format, isSameMonth, isWeekend, isToday, parseISO
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { TYPE_META, FALLBACK_TYPE_META } from '../constants'
import { isDateInRange, leaveOverlapsMonth } from '../utils/dateHelpers'

const STATUS_LABELS = {
  pending: 'En attente',
  approved: 'Approuvé',
  rejected: 'Refusé',
}

// Grid shows approved leaves solid and pending ones hatched with a “?”;
// rejected leaves never appear on the grid (only in the lists, badged).
function isOnLeave(employee, date, leaves) {
  const d = format(date, 'yyyy-MM-dd')
  return leaves.find(l =>
    l.employee === employee && l.status !== 'rejected' &&
    isDateInRange(d, l.startDate, l.endDate)
  )
}

export default function Calendar({ leaves, employees, currentUser, isAdmin, isSuperAdmin, visibleTeamKeys = [], onDelete }) {
  const [month, setMonth] = useState(new Date())

  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)

  // Build weeks: each week = 7 days covering part of the month
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const allDays = eachDayOfInterval({ start: calStart, end: calEnd })

  // Group into weeks
  const weeks = []
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7))
  }

  const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

  // Visibilité par équipe :
  // - Super admin : voit les équipes dans visibleTeamKeys
  // - Employé classique : voit seulement sa propre ligne
  const activeAll = employees.filter(e => e.active)
  const roster = isSuperAdmin
    ? activeAll.filter(e => visibleTeamKeys.includes(e.teamKey))
    : activeAll.filter(e => e.name === currentUser)

  // Leaves overlapping this month (correctly includes multi-month leaves).
  const monthStartStr = format(monthStart, 'yyyy-MM-dd')
  const monthEndStr = format(monthEnd, 'yyyy-MM-dd')
  const monthLeaves = leaves.filter(l =>
    l.status !== 'rejected' && leaveOverlapsMonth(l, monthStartStr, monthEndStr)
  )

  const myLeaves = leaves.filter(l => l.employee === currentUser)

  return (
    <div className="calendar-container">
      <div className="calendar-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2>{format(month, 'MMMM yyyy', { locale: fr })}</h2>
          <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', borderRadius: 20, padding: '2px 10px' }}>
            {monthLeaves.length} congé{monthLeaves.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="nav-buttons">
          <button aria-label="Mois précédent" onClick={() => setMonth(subMonths(month, 1))}>◀ Préc.</button>
          <button aria-label="Aller au mois actuel" onClick={() => setMonth(new Date())}>Aujourd'hui</button>
          <button aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}>Suiv. ▶</button>
        </div>
      </div>

      <div className="calendar-grid">
        {/* Per-week grid */}
        {weeks.map((week) => (
          <div key={format(week[0], 'yyyy-MM-dd')}>
            {/* Week day headers */}
            <div className="week-header">
              <div className="week-label">S{format(week[0], 'w')}</div>
              {week.map((day, di) => (
                <div
                  key={format(day, 'yyyy-MM-dd')}
                  className={`week-day-header ${isWeekend(day) ? 'weekend' : ''}`}
                >
                  {DAY_LABELS[di]} {format(day, 'd')}
                </div>
              ))}
            </div>

            {/* Employee rows */}
            {roster.map(emp => {
              const empLeaves = week.map(day => isOnLeave(emp.name, day, leaves))
              const hasLeave = empLeaves.some(Boolean)
              if (!hasLeave && !isSameMonth(week[3], month)) return null

              return (
                <div key={emp.name} className="employee-row">
                  <div className="employee-name" title={`${emp.name} — ${emp.team}`}>
                    {emp.name === currentUser ? <strong>{emp.name}</strong> : emp.name}
                  </div>
                  {week.map((day, di) => {
                    const leave = empLeaves[di]
                    const inMonth = isSameMonth(day, month)
                    const meta = leave ? TYPE_META[leave.type] || FALLBACK_TYPE_META : null
                    const pending = leave?.status === 'pending'

                    return (
                      <div
                        key={format(day, 'yyyy-MM-dd')}
                        className={`day-cell ${isWeekend(day) ? 'weekend' : ''} ${isToday(day) ? 'today' : ''} ${leave ? 'on-leave' : ''} ${leave && emp.name === currentUser ? 'is-mine' : ''} ${pending ? 'is-pending' : ''}`}
                        style={leave && inMonth ? { background: meta.bg } : {}}
                        title={leave ? `${meta.label} — ${STATUS_LABELS[leave.status]}${leave.note ? ' — ' + leave.note : ''}` : ''}
                      >
                        {leave && inMonth && (
                          <div className="leave-dot">
                            {meta.short}{pending ? ' ?' : ''}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Leave summary list */}
      <div className="summary-panel">
        <h3>
          {isAdmin
            ? `Tous les congés — ${format(month, 'MMMM yyyy', { locale: fr })}`
            : 'Mes congés'}
        </h3>
        <div className="leave-list">
          {(isAdmin ? monthLeaves : myLeaves).length === 0 ? (
            <div className="no-leaves">Aucun congé ce mois</div>
          ) : (
            (isAdmin ? monthLeaves : myLeaves).map(l => (
              <div key={l.id} className="leave-item">
                <div className="leave-item-info">
                  <span className="leave-item-name">{l.employee}</span>
                  <span className="leave-item-dates">
                    {l.startDate === l.endDate
                      ? format(parseISO(l.startDate), 'd MMMM yyyy', { locale: fr })
                      : `${format(parseISO(l.startDate), 'd MMM', { locale: fr })} → ${format(parseISO(l.endDate), 'd MMM yyyy', { locale: fr })}`}
                    {l.note && <> · {l.note}</>}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status-badge status-${l.status}`}>
                    {STATUS_LABELS[l.status] || l.status}
                  </span>
                  <span className="leave-item-type">
                    {(TYPE_META[l.type] || FALLBACK_TYPE_META).short} {(TYPE_META[l.type] || FALLBACK_TYPE_META).label}
                  </span>
                  {(isAdmin || l.employee === currentUser) && (
                    <button
                      className="btn-danger"
                      onClick={() => {
                        if (window.confirm(`Supprimer le congé de ${l.employee} ? Action irréversible.`)) {
                          onDelete(l.id)
                        }
                      }}
                      title="Supprimer"
                      aria-label={`Supprimer le congé de ${l.employee}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
