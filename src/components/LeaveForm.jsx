import { useState } from 'react'
import { format } from 'date-fns'

const LEAVE_TYPES = [
  { key: 'conge_paye', label: '🏖️ Congé payé' },
  { key: 'rtt', label: '⚡ RTT' },
  { key: 'maladie', label: '🤒 Maladie' },
  { key: 'autre', label: '📋 Autre' },
]

export default function LeaveForm({ onSubmit, onCancel }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [type, setType] = useState('conge_paye')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!startDate || !endDate || startDate > endDate) return
    setSubmitting(true)
    await onSubmit({ startDate, endDate, type, note })
    setSubmitting(false)
  }

  return (
    <div className="form-container">
      <div className="form-card">
        <h2>Poser un congé</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Type de congé</label>
            <div className="leave-types">
              {LEAVE_TYPES.map(lt => (
                <button
                  key={lt.key}
                  type="button"
                  className={`leave-type-btn ${type === lt.key ? 'selected' : ''}`}
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
              {submitting ? 'Enregistrement...' : 'Confirmer le congé'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
