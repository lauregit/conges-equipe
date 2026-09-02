import { useState, useEffect, useCallback } from 'react'
import { fetchAdmin, adminAction, exportPayroll } from '../api'
import { sameName, normName } from '../utils/names'
import { chainOf, canSee } from '../leavePolicy'

// Mois précédent, au format YYYY-MM-DD (bornes) — période par défaut la plus
// utile pour un export de paie (le mois qui vient de se terminer).
function previousMonthRange() {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const iso = (d) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

// ⚙️ Administration (admins globaux) :
// 1. Comptes : liaisons compte→nom en attente (email ≠ email RH) à valider,
//    liste des comptes liés.
// 2. Chaîne de commandement : pour chaque salarié, son N+1 (jusqu'à 5
//    niveaux — visibilité descendante) et son SUPERVISEUR RH (seul
//    destinataire de ses demandes de congé).
// 3. Admins globaux (config en base).
// Admins globaux : tout. Managers : uniquement la section organigramme,
// limitée à leur périmètre (sous-arbre + personnes qu'ils valident).
export default function AdminPanel({ employees, currentUser, isGlobalAdmin = false, config, onChanged }) {
  const [data, setData] = useState(null) // { bindings, config, hierarchy }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [filter, setFilter] = useState('')
  const [adminsDraft, setAdminsDraft] = useState(null)
  const [payrollRange, setPayrollRange] = useState(previousMonthRange)
  const [payrollBusy, setPayrollBusy] = useState(false)
  const [payrollError, setPayrollError] = useState('')

  async function handleExportPayroll() {
    setPayrollBusy(true)
    setPayrollError('')
    try {
      const { blob, filename } = await exportPayroll(payrollRange.from, payrollRange.to)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setPayrollError(err.message || "Échec de l'export")
    } finally {
      setPayrollBusy(false)
    }
  }

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
  // Périmètre : admins → tout le monde ; manager → son sous-arbre + les
  // personnes qu'il valide, jamais lui-même (le serveur applique la même règle).
  const scoped = isGlobalAdmin
    ? employees
    : employees.filter(e =>
        !sameName(e.name, currentUser) && canSee(currentUser, e.name, employees, config))
  const shown = filter
    ? scoped.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()) || e.team.toLowerCase().includes(filter.toLowerCase()))
    : scoped

  // Pôles proposés pour l'affichage (les SAV se répartissent France/International).
  const poleChoices = [...new Set([
    ...employees.map(e => e.team),
    'SAV — France', 'SAV — International',
  ])].sort()

  function hierRow(emp) {
    const h = hierByName.get(normName(emp.name)) || {}
    const reps = h.replacements || []
    return (
      <div key={emp.name} className="team-row" style={{ gridTemplateColumns: '1.2fr 0.7fr 1fr 1fr 1fr 0.9fr' }}>
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
        <select
          value={emp.teamOverride || ''}
          aria-label={`Pôle d'affichage de ${emp.name}`}
          disabled={busy === `t:${emp.name}`}
          onChange={e => act({ action: 'set-team-override', employee: emp.name, teamOverride: e.target.value }, `t:${emp.name}`)}
        >
          <option value="">— Pôle (auto) —</option>
          {poleChoices.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div className="team-container">
      <h2>{isGlobalAdmin ? '⚙️ Administration' : '🛠️ Mon équipe'}</h2>
      {error && <div className="banner banner-error">⚠️ {error}</div>}

      {isGlobalAdmin && <div className="presence-team">
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
      </div>}

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

      {isGlobalAdmin && <div className="presence-team">
        <h3>📤 Export variables de paie</h3>
        <p className="team-hint">
          CSV pour le responsable paie : jours de congé payé, sans solde et arrêt
          maladie APPROUVÉS par salarié, sur la période choisie (télétravail exclu).
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
            Du
            <input
              type="date"
              value={payrollRange.from}
              onChange={e => setPayrollRange(r => ({ ...r, from: e.target.value }))}
              aria-label="Début de période paie"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
            Au
            <input
              type="date"
              value={payrollRange.to}
              onChange={e => setPayrollRange(r => ({ ...r, to: e.target.value }))}
              aria-label="Fin de période paie"
            />
          </label>
          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            disabled={payrollBusy || payrollRange.from > payrollRange.to}
            onClick={handleExportPayroll}
          >
            {payrollBusy ? 'Génération…' : 'Télécharger le CSV'}
          </button>
        </div>
        {payrollError && <p className="auth-error">{payrollError}</p>}
      </div>}

      {isGlobalAdmin && <div className="presence-team">
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
      </div>}
    </div>
  )
}
