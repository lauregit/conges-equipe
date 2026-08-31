import { sameName } from '../utils/names'

// Vue Équipes — LECTURE SEULE, reflet de l'organigramme RH Compliance.
// Le personnel et les managers se gèrent dans RH Compliance
// (https://rh-compliance.vercel.app) ; les approbateurs supplémentaires
// dans src/employees.js (config déployée avec l'app).
export default function TeamSettings({ employees, config = {} }) {
  const EXTRA_APPROVERS = config.extraApprovers || {}
  const GLOBAL_SUPER_ADMINS = config.globalAdmins || []
  const teams = [...new Set(employees.map(e => e.team))].sort()

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
