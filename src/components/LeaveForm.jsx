import { useState } from 'react'
import { format } from 'date-fns'
import { doLeavesOverlap } from '../utils/dateHelpers'
import { LEAVE_TYPES as TYPE_KEYS, TYPE_META, DECLARED_TYPES } from '../constants'
const LEAVE_TYPES = TYPE_KEYS.map(key => ({ key, label: `${TYPE_META[key].emoji} ${TYPE_META[key].label}` }))

export default function LeaveForm({ onSubmit, onCancel, currentUser, isSuperAdmin, visibleEmployees = [], myLeaves = [], allLeaves = [], teamHasManager = false }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  // Super admins can fill in for anyone
  const [actingFor, setActingFor] = useState(currentUser)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [type, setType] = useState('conge_paye')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Leaves for whoever we're acting for (to detect overlaps)
  const targetLeaves = isSuperAdmin
    ? allLeaves.filter(l => l.employee === actingFor)
    : myLeaves

  const declared = DECLARED_TYPES.includes(type)
  const validRange = startDate && endDate && startDate <= endDate
  const overlaps = validRange && targetLeaves.some(l =>
    l.status !== 'rejected' && doLeavesOverlap(startDate, endDate, l)
  )

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validRange) return
    setSubmitting(true)
    try {
      await onSubmit({ startDate, endDate, type, note, employee: actingFor })
      // On success the parent navigates back to the calendar (unmounts us),
      // so we intentionally don't reset `submitting` here.
    } catch {
      // Parent shows the error toast; keep the form open and re-enable submit.
      setSubmitting(false)
    }
  }

  return (
    <div className="form-container">
      <div className="form-card">
        <h2>Poser un congé{isSuperAdmin && actingFor !== currentUser ? ` pour ${actingFor}` : ''}</h2>
        <form onSubmit={handleSubmit}>
          {isSuperAdmin && (
            <div className="form-group">
              <label>👑 Saisir pour</label>
              <select value={actingFor} onChange={e => setActingFor(e.target.value)}>
                {visibleEmployees.map(n => (
                  <option key={n} value={n}>{n}{n === currentUser ? ' (moi)' : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Type de congé</label>
            <div className="leave-types">
              {LEAVE_TYPES.map(lt => (
                <button
                  key={lt.key}
                  type="button"
                  className={`leave-type-btn ${type === lt.key ? 'selected' : ''}`}
                  aria-pressed={type === lt.key}
                  onClick={() => setType(lt.key)}
                >
                  {lt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Date de début</label>
              <input
                type="date"
                value={startDate}
                min={today}
                onChange={e => {
                  setStartDate(e.target.value)
                  if (e.target.value > endDate) setEndDate(e.target.value)
                }}
                required
              />
            </div>
            <div className="form-group">
              <label>Date de fin</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          {overlaps && (
            <div className="banner banner-warning" role="alert">
              ⚠️ Vous avez déjà un congé sur ces dates.
            </div>
          )}

          <div className="banner banner-info" role="note">
            {declared
              ? 'ℹ️ Un arrêt maladie est déclaré immédiatement — vos managers seront informés.'
              : teamHasManager
                ? 'ℹ️ Votre demande sera soumise à l’approbation de votre manager.'
                : 'ℹ️ Le congé sera enregistré directement au calendrier.'}
          </div>

          <div className="form-group">
            <label>Note (optionnel)</label>
            <input
              type="text"
              placeholder="Ex: Vacances famille..."
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={80}
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Enregistrement...'
                : declared ? "Déclarer l'absence"
                : teamHasManager ? 'Envoyer la demande'
                : 'Confirmer le congé'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
