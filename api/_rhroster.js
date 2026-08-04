import postgres from 'postgres';

// Chargement serveur du personnel + organigramme depuis la base RH Compliance.
// Partagé par /api/roster (endpoint public) et /api/leaves (validation des
// écritures côté serveur). Champs annuaire uniquement — jamais de données
// RH sensibles.

let _sql;
function getRhSql() {
  const url = process.env.RH_POSTGRES_URL;
  if (!url) throw new Error('RH_POSTGRES_URL not configured');
  if (!_sql) {
    _sql = postgres(url, { ssl: { rejectUnauthorized: false }, max: 1, idle_timeout: 20 });
  }
  return _sql;
}

// Rattache les équipes "atelier" (souvent des intérimaires, sans pôle saisi)
// au pôle de l'organigramme correspondant.
const TEAM_TO_POLE = {
  'Expé': 'Logistique',
  'Expédition': 'Logistique',
  'Reconditionnement': 'Logistique',
  'Retour': 'Logistique',
  'Test': 'Logistique',
  'Init': 'Logistique',
  'Market': 'Marketing',
};

function groupOf(e) {
  const pole = String(e.pole || '').trim();
  if (pole) return pole;
  const team = String(e.team || '').trim();
  return TEAM_TO_POLE[team] || team || 'Autre';
}

// Détection "manager" depuis l'organigramme RH (voir api/roster.js pour la
// justification des motifs — attention aux faux positifs type
// "assistant/junior/key account manager").
function isOrgManager(e) {
  const posteReel = String(e.poste_reel || '').toUpperCase();
  const position = String(e.position || '').toUpperCase();
  if (/(^|\s)(MANAGER|RESPONSABLE)(\s|$|\/)/.test(posteReel)) return true;
  if (/^(HEAD OF|CTO$|CEO$|DG$|DIRECTEUR|DIRECTRICE|RESPONSABLE|MANAGER )/.test(position)) return true;
  if (Number(e.ranking) >= 5) return true;
  return false;
}

// Salariés (CDI + alternants) actifs, format roster de l'app.
export async function loadRoster(sqlOverride) {
  const sql = sqlOverride || getRhSql();
  const rows = await sql`SELECT data FROM rh_entities WHERE kind = 'employee'`;
  return rows
    .map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data))
    .filter(e => e && e.active !== false && e.first_name && e.last_name &&
      (e.type === 'cdi' || e.type === 'alternant'))
    .map(e => ({
      id: e.id,
      name: `${String(e.first_name).trim()} ${String(e.last_name).trim()}`,
      email: e.email || null,
      team: groupOf(e),
      position: e.position || e.poste_reel || null,
      manager: isOrgManager(e),
      type: e.type || null,
    }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}
