import { useState } from 'react'
import { sameName } from '../utils/names'
import { importFirestoreLeaves } from '../api'

// Vue Équipes — LECTURE SEULE, reflet de l'organigramme RH Compliance.
// Le personnel et les managers se gèrent dans RH Compliance
// (https://rh-compliance.vercel.app) ; les approbateurs supplémentaires
// dans src/employees.js (config déployée avec l'app).
export default function TeamSettings({ employees, config = {}, currentUser, isGlobalAdmin = false, onImported }) {
  const EXTRA_APPROVERS = config.extraApprovers || {}
  const GLOBAL_SUPER_ADMINS = config.globalAdmins || []
  const teams = [...new Set(employees.map(e => e.team))].sort()
  const [importState, setImportState] = useState(null) // null | 'running' | string résultat

  // Import one-shot des congés restés dans Firestore (ancienne base).
  // Les règles Firestore n'autorisent que les sessions de l'app : la lecture
  // se fait donc ICI, dans le navigateur de l'admin connecté, puis les
  // documents sont poussés vers Neon (idempotent, re-cliquable sans risque).
  async function runImport() {
    setImportState('running')
    try {
      const [{ collection, getDocs }, { db }] = await Promise.all([
        import('firebase/firestore'),
        import('../firebase'),
      ])
      const snap = await getDocs(collection(db, 'leaves'))
      const rows = snap.docs.map(d => {
        const l = d.data()
        return {
          firestoreId: d.id,
          employee: l.employee,
          startDate: l.startDate,
          endDate: l.endDate,
          type: l.type,
          note: l.note || '',
          status: l.status || 'approved',
          submittedBy: l.submittedBy || null,
          decidedBy: l.decidedBy || null,
          createdAt: l.createdAt?.toDate ? l.createdAt.toDate().toISOString() : null,
        }
      })
      if (rows.length === 0) {
        setImportState('Firestore ne contient aucun congé.')
        return
      }
      const r = await importFirestoreLeaves(currentUser, rows)
      setImportState(`✓ ${r.imported} importé(s), ${r.skipped} déjà présent(s), ${r.invalid} invalide(s).`)
      onImported?.()
    } catch (err) {
      setImportState(`✗ ${err.message || 'Échec de l’import'}`)
    }
  }

  const isExtraApprover = (name, team) =>
    (EXTRA_APPROVERS[team] || []).some(a => sameName(a, name))
  const isGlobal = name => GLOBAL_SUPER_ADMINS.some(a => sameName(a, name))

  return (
    <div className="team-container">
      <h2>Équipes & approbateurs</h2>
      <p className="team-hint">
        👤 Personnel et organigramme viennent de{' '}
        <a href="https://rh-compliance.vercel.app" target="_blank" rel="noopener noreferrer">RH Compliance</a>.
        ⭐ = manager du pôle (organigramme) ou approbateur délégué — valide les demandes de congé ·
        👑 = admin global. Un pôle sans approbateur enregistre les congés directement.
      </p>
      {isGlobalAdmin && (
        <div className="banner banner-info" style={{ marginBottom: 16 }}>
          🗄️ Migration : les congés vivent désormais dans Neon Postgres.
          <button
            className="btn-primary"
            style={{ marginLeft: 10 }}
            disabled={importState === 'running'}
            onClick={runImport}
          >
            {importState === 'running' ? 'Import…' : 'Importer depuis Firestore'}
          </button>
          {importState && importState !== 'running' && <span style={{ marginLeft: 8 }}>{importState}</span>}
        </div>
      )}
      {teams.map(team => {
        const members = employees.filter(e => e.team === team)
        const hasApprover = members.some(m => m.manager) ||
          (EXTRA_APPROVERS[team] || []).length > 0
        return (
          <div key={team} className="presence-team">
            <h3>
              {team}
              <span className="presence-count">{members.length} membre{members.length > 1 ? 's' : ''}</span>
              {!hasApprover && (
                <span className="team-tag" title="Aucun approbateur : congés enregistrés directement (hors admins globaux)">
                  sans manager
                </span>
              )}
            </h3>
            <div className="presence-list">
              {members.map(m => (
                <div key={m.name} className="presence-item">
                  <span className="presence-name">
                    {m.name}
                    {isGlobal(m.name) ? ' 👑' : (m.manager || isExtraApprover(m.name, team)) ? ' ⭐' : ''}
                  </span>
                  <span className="presence-status">{m.position || m.email || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
