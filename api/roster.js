import postgres from 'postgres';

// Personnel officiel, lu depuis la base RH Compliance (Supabase Postgres,
// table rh_entities kind='employee' — même source que rh-compliance.vercel.app).
//
// SEULS des champs "annuaire + organigramme" sont exposés (nom, email,
// pôle/équipe, intitulé de poste, drapeau manager). Jamais de données RH
// sensibles (salaires, classifications, dates de contrat, période d'essai...)
// — le whitelisting est volontairement strict.

let _sql;
function getSql() {
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

// Détection "manager" depuis l'organigramme RH :
// - poste_reel du type "MANAGER EXPE", "RESPONSABLE RETOUR"...
// - intitulé de poste commençant par HEAD OF / CTO / CEO / DIRECTEUR /
//   RESPONSABLE / MANAGER (mais PAS "assistant manager", "junior manager",
//   "key account manager", "supply manager"... qui ne managent pas un pôle)
// - ranking >= 5 (têtes de pôle dans l'organigramme)
function isOrgManager(e) {
  const posteReel = String(e.poste_reel || '').toUpperCase();
  const position = String(e.position || '').toUpperCase();
  if (/(^|\s)(MANAGER|RESPONSABLE)(\s|$|\/)/.test(posteReel)) return true;
  if (/^(HEAD OF|CTO$|CEO$|DG$|DIRECTEUR|DIRECTRICE|RESPONSABLE|MANAGER )/.test(position)) return true;
  if (Number(e.ranking) >= 5) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT data FROM rh_entities WHERE kind = 'employee'
    `;
    const items = rows
      .map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data))
      // Salariés uniquement (CDI + alternants) : les intérimaires ne posent
      // pas de congés via l'entreprise (gérés par leur agence).
      .filter(e => e && e.active !== false && e.first_name && e.last_name &&
        (e.type === 'cdi' || e.type === 'alternant'))
      .map(e => ({
        // Champs annuaire/organigramme uniquement — ne JAMAIS élargir sans revue.
        id: e.id,
        name: `${String(e.first_name).trim()} ${String(e.last_name).trim()}`,
        email: e.email || null,
        team: groupOf(e),
        position: e.position || e.poste_reel || null,
        manager: isOrgManager(e),
        type: e.type || null,
      }))
      .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));

    // Le roster bouge rarement : cache CDN 5 min pour épargner la base RH.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ items });
  } catch (err) {
    console.error('roster api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
