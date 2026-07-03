import { useState } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, addMonths, subMonths,
  format, isSameMonth, isWeekend, isToday, parseISO
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { ALL_EMPLOYEES } from '../employees'
import { isDateInRange, leaveOverlapsMonth } from '../utils/dateHelpers'

const TYPE_COLORS = {
  conge_paye:       { bg: '#bfdbfe', label: 'CP' },
  conge_sans_solde: { bg: '#fed7aa', label: 'CSS' },
  teletravail:      { bg: '#d9f99d', label: '🏠' },
  arret_maladie:    { bg: '#fecaca', label: '🤒' },
}

function isOnLeave(employee, date, leaves) {
  const d = format(date, 'yyyy-MM-dd')
  return leaves.find(l =>
    l.employee === employee && isDateInRange(d, l.startDate, l.endDate)
  )
}

export default function Calendar({ leaves, currentUser, isAdmin, onDelete }) {
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

  // Leaves overlapping this month (correctly includes multi-month leaves,
  // e.g. 15 Jan → 20 Feb now counts in February).
  const monthStartStr = format(monthStart, 'yyyy-MM-dd')
  const monthEndStr = format(monthEnd, 'yyyy-MM-dd')
  const monthLeaves = leaves.filter(l => leaveOverlapsMonth(l, monthStartStr, monthEndStr))

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
            {ALL_EMPLOYEES.map(emp => {
              const empLeaves = week.map(day => isOnLeave(emp, day, leaves))
              const hasLeave = empLeaves.some(Boolean)
              if (!hasLeave && !isSameMonth(week[3], month)) return null

              return (
                <div key={emp} className="employee-row">
                  <div className="employee-name" title={emp}>
                    {emp === currentUser ? <strong>{emp}</strong> : emp}
                  </div>
                  {week.map((day, di) => {
                    const leave = empLeaves[di]
                    const inMonth = isSameMonth(day, month)
                    const colors = leave ? TYPE_COLORS[leave.type] || TYPE_COLORS.autre : null

                    return (
                      <div
                        key={format(day, 'yyyy-MM-dd')}
                        className={`day-cell ${isWeekend(day) ? 'weekend' : ''} ${isToday(day) ? 'today' : ''} ${leave ? 'on-leave' : ''} ${leave && emp === currentUser ? 'is-mine' : ''}`}
                        style={leave && inMonth ? { background: colors.bg } : {}}
                        title={leave ? `${leave.type}${leave.note ? ' — ' + leave.note : ''}` : ''}
                      >
                        {leave && inMonth && (
                          <div className="leave-dot">
                            {colors.label}
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
                  <span className="leave-item-type">
                    {TYPE_COLORS[l.type]?.label} {l.type.replace('_', ' ')}
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
