import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { doLeavesOverlap } from '../utils/dateHelpers'
import { LEAVE_TYPES as TYPE_KEYS, TYPE_META, DECLARED_TYPES, RESTRICTED_SUBMIT_TYPES } from '../constants'
import { initialStatus, isSpecialRequest, replacementConflicts } from '../leavePolicy'
import { sameName } from '../utils/names'
const LEAVE_TYPES = TYPE_KEYS.map(key => ({ key, label: `${TYPE_META[key].emoji} ${TYPE_META[key].label}` }))

export default function LeaveForm({ onSubmit, onCancel, currentUser, isSuperAdmin, amGlobalAdmin = false, amRestrictedHR = false, visibleEmployees = [], myLeaves = [], allLeaves = [], roster = [], config }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  // Super admins can fill in for anyone
  const [actingFor, setActingFor] = useState(currentUser)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [type, setType] = useState('conge_paye')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Congé sans solde / arrêt maladie : jamais en libre-service — seulement
  // en tant que manager saisissant POUR quelqu'un d'autre, admin global, ou
  // RH désignée (voir api/leaves.js, même règle appliquée côté serveur).
  const restrictedTypesAllowed = amGlobalAdmin || amRestrictedHR || actingFor !== currentUser
  useEffect(() => {
    if (!restrictedTypesAllowed && RESTRICTED_SUBMIT_TYPES.includes(type)) setType('conge_paye')
  }, [restrictedTypesAllowed, type])

  // Leaves for whoever we're acting for (to detect overlaps)
  const targetLeaves = isSuperAdmin
    ? allLeaves.filter(l => sameName(l.employee, actingFor))
    : myLeaves

  const declared = DECLARED_TYPES.includes(type)
  const validRange = startDate && endDate && startDate <= endDate
  const special = validRange && isSpecialRequest({ startDate, endDate, type })
  // Remplaçants (organigramme partagé) : binôme déjà absent sur ces dates ?
  const repConflicts = validRange
    ? replacementConflicts({ employee: actingFor, startDate, endDate, type }, roster, allLeaves)
    : []
  const overlaps = validRange && targetLeaves.some(l =>
    l.status !== 'rejected' && doLeavesOverlap(startDate, endDate, l)
  )
  // Le vrai verdict vient de la même règle que le serveur : ce que dira
  // initialStatus au moment de l'enregistrement.
  const willBePending = initialStatus(
    { type, employee: actingFor, submittedBy: currentUser },
    roster,
    config
  ) === 'pending'

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
              {LEAVE_TYPES.map(lt => {
                const disabled = RESTRICTED_SUBMIT_TYPES.includes(lt.key) && !restrictedTypesAllowed
                return (
                  <button
                    key={lt.key}
                    type="button"
                    className={`leave-type-btn ${type === lt.key ? 'selected' : ''}`}
                    aria-pressed={type === lt.key}
                    disabled={disabled}
                    title={disabled ? 'À faire remplir par votre responsable d’équipe ou le service RH' : undefined}
                    onClick={() => setType(lt.key)}
                  >
                    {lt.label}
                  </button>
                )
              })}
            </div>
            {!restrictedTypesAllowed && (
              <p className="team-hint" style={{ marginTop: 6 }}>
                Congé sans solde et arrêt maladie : à faire remplir par votre responsable
                d’équipe ou le service RH — vous ne pouvez pas les déclarer vous-même.
              </p>
            )}
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

          {special && (
            <div className="banner banner-warning" role="alert">
              ⚠️ Demande spéciale : plus de 2 semaines. Elle devra être validée par la direction (Laure / Yoann), pas par votre superviseur habituel.
            </div>
          )}

          {repConflicts.length > 0 && (
            <div className="banner banner-warning" role="alert">
              ⚠️ Conflit de remplacement : {repConflicts[0].employee} est absent(e) du{' '}
              {repConflicts[0].startDate} au {repConflicts[0].endDate}. Vous êtes mutuellement
              remplaçants — vous ne pouvez pas être absents en même temps.
            </div>
          )}

          <div className="banner banner-info" role="note">
            {declared
              ? 'ℹ️ Un arrêt maladie est déclaré immédiatement — vos managers seront informés.'
              : willBePending
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
                : willBePending ? 'Envoyer la demande'
                : 'Confirmer le congé'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
