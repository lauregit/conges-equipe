import { useState, useEffect, useCallback } from 'react'
import { fetchAdmin, adminAction } from '../api'
import { sameName, normName } from '../utils/names'
import { chainOf } from '../leavePolicy'

// ⚙️ Administration (admins globaux) :
// 1. Comptes : liaisons compte→nom en attente (email ≠ email RH) à valider,
//    liste des comptes liés.
// 2. Chaîne de commandement : pour chaque salarié, son N+1 (jusqu'à 5
//    niveaux — visibilité descendante) et son SUPERVISEUR RH (seul
//    destinataire de ses demandes de congé).
// 3. Admins globaux (config en base).
export default function AdminPanel({ employees, onChanged }) {
  const [data, setData] = useState(null) // { bindings, config, hierarchy }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [filter, setFilter] = useState('')
  const [adminsDraft, setAdminsDraft] = useState(null)

  const load = useCallback(async () => {
    try {
      setData(await fetchAdmin())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function act(payload, busyKey) {
    setBusy(busyKey)
    try {
      await adminAction(payload)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <div className="loading-state">{error || 'Chargement de l’administration…'}</div>

  const pending = data.bindings.filter(b => b.status === 'pending')
  const hierByName = new Map(data.hierarchy.map(h => [normName(h.employee), h]))
  const names = employees.map(e => e.name)
  const shown = filter
    ? employees.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()) || e.team.toLowerCase().includes(filter.toLowerCase()))
    : employees

  function hierRow(emp) {
    const h = hierByName.get(normName(emp.name)) || {}
    const reps = h.replacements || []
    return (
      <div key={emp.name} className="team-row" style={{ gridTemplateColumns: '1.3fr 0.8fr 1.1fr 1.1fr 1.1fr' }}>
        <span title={chainOf(emp.name, employees).join(' → ') || '—'}>
          {emp.name}
          <span className="team-tag">{emp.team}</span>
        </span>
        <span className="presence-status">{emp.position || ''}</span>
        <select
          value={h.supervisor || ''}
          aria-label={`N+1 de ${emp.name}`}
          disabled={busy === `h:${emp.name}`}
          onChange={e => act({ action: 'set-hierarchy', employee: emp.name, supervisor: e.target.value, rhSupervisor: h.rhSupervisor || '' }, `h:${emp.name}`)}
        >
          <option value="">— N+1 (chaîne) —</option>
          {names.filter(n => !sameName(n, emp.name)).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          value={h.rhSupervisor || ''}
          aria-label={`Superviseur RH de ${emp.name}`}
          disabled={busy === `h:${emp.name}`}
          onChange={e => act({ action: 'set-hierarchy', employee: emp.name, supervisor: h.supervisor || '', rhSupervisor: e.target.value }, `h:${emp.name}`)}
        >
          <option value="">— Superviseur RH (approbation) —</option>
          {names.filter(n => !sameName(n, emp.name)).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {reps.map(r => (
            <span key={r} className="team-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {r}
              <button
                type="button"
                aria-label={`Retirer ${r} des remplaçants de ${emp.name}`}
                disabled={busy === `r:${emp.name}`}
                onClick={() => act({ action: 'set-replacements', employee: emp.name, replacements: reps.filter(x => !sameName(x, r)) }, `r:${emp.name}`)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
              >✕</button>
            </span>
          ))}
          <select
            value=""
            aria-label={`Ajouter un remplaçant à ${emp.name}`}
            disabled={busy === `r:${emp.name}`}
            onChange={e => {
              if (!e.target.value) return
              act({ action: 'set-replacements', employee: emp.name, replacements: [...reps, e.target.value] }, `r:${emp.name}`)
            }}
          >
            <option value="">+ remplaçant…</option>
            {names.filter(n => !sameName(n, emp.name) && !reps.some(r => sameName(r, n))).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </span>
      </div>
    )
  }

  return (
    <div className="team-container">
      <h2>⚙️ Administration</h2>
      {error && <div className="banner banner-error">⚠️ {error}</div>}

      <div className="presence-team">
        <h3>Comptes en attente de validation <span className="presence-count">{pending.length}</span></h3>
        {pending.length === 0 ? (
          <div className="no-leaves">Aucune liaison en attente.</div>
        ) : pending.map(b => (
          <div key={b.uid} className="leave-item">
            <div className="leave-item-info">
              <span className="leave-item-name">{b.name}</span>
              <span className="leave-item-dates">{b.email} · demandé le {b.createdAt} · email RH ≠ email de connexion</span>
            </div>
            <div className="approval-actions">
              <button className="btn-approve" disabled={busy === b.uid} onClick={() => act({ action: 'approve-binding', uid: b.uid }, b.uid)}>✓ Valider</button>
              <button className="btn-reject" disabled={busy === b.uid} onClick={() => act({ action: 'reject-binding', uid: b.uid }, b.uid)}>✗ Refuser</button>
            </div>
          </div>
        ))}
      </div>

      <div className="presence-team">
        <h3>Chaîne de commandement &amp; remplaçants <span className="presence-count">{data.hierarchy.length} définie(s)</span></h3>
        <p className="team-hint">
          N+1 = chaîne de visibilité (jusqu'à 5 niveaux : chacun voit les données des personnes
          en dessous de lui). Superviseur RH = <strong>seul destinataire</strong> des demandes de
          congé de la personne. Sans superviseur RH : repli sur les managers du pôle.
          Remplaçants = binômes qui se couvrent : ils <strong>ne peuvent pas être absents en même
          temps</strong>. Données partagées avec RH Compliance (page « Organigramme &amp; Remplaçants ») —
          toute modification ici s'applique aussi là-bas, et inversement.
        </p>
        <input
          placeholder="Filtrer par nom ou équipe…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ marginBottom: 10 }}
          aria-label="Filtrer le personnel"
        />
        <div className="team-table">
          {shown.map(hierRow)}
        </div>
      </div>

      <div className="presence-team">
        <h3>Admins globaux</h3>
        <p className="team-hint">Voient tout, approuvent tout, gèrent cet onglet.</p>
        {(adminsDraft || data.config.globalAdmins).map((a, i) => (
          <div key={i} className="leave-item" style={{ padding: '6px 14px' }}>
            <span>{a}</span>
            <button
              className="btn-danger"
              onClick={() => setAdminsDraft((adminsDraft || data.config.globalAdmins).filter((_, j) => j !== i))}
              aria-label={`Retirer ${a}`}
            >✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select
            value=""
            aria-label="Ajouter un admin global"
            onChange={e => {
              if (!e.target.value) return
              const cur = adminsDraft || data.config.globalAdmins
              if (!cur.some(a => sameName(a, e.target.value))) setAdminsDraft([...cur, e.target.value])
            }}
          >
            <option value="">+ Ajouter un admin…</option>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            className="btn-primary"
            disabled={!adminsDraft || busy === 'config'}
            onClick={() => act({ action: 'save-config', config: { ...data.config, globalAdmins: adminsDraft } }, 'config').then(() => setAdminsDraft(null))}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
