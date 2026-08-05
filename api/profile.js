import { neon } from '@neondatabase/serverless';
import { requireToken } from './_auth.js';
import { loadConfig, BOOTSTRAP_ADMIN_EMAILS } from './_config.js';
import { loadRoster } from './_rhroster.js';
import { findByName } from '../src/utils/names.js';
import { isGlobalAdmin } from '../src/leavePolicy.js';

// Liaison compte connecté -> nom du personnel (table conges_profiles).
// Anti-usurpation : la liaison n'est validée automatiquement QUE si l'email
// de connexion (vérifié par jeton) correspond à l'email RH de la personne
// (ou email d'amorçage admin). Sinon elle reste "pending" jusqu'à validation
// par un admin (onglet Admin).
//   GET               -> { name, status } du compte connecté | 404
//   POST {name}       -> crée/remplace SA liaison (uid + email du jeton)

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql) _sql = neon(url);
  return _sql;
}

export default async function handler(req, res, overrides = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const user = await requireToken(req, res, overrides.verify);
    if (!user) return;
    const sql = overrides.sql || getSql();

    if (req.method === 'GET') {
      const rows = await sql('SELECT name, status FROM conges_profiles WHERE uid = $1', [user.uid]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Profil introuvable' });
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const name = String(body.name || '').trim();
      if (!name) {
        res.status(400).json({ error: 'name requis' });
        return;
      }

      const roster = overrides.roster || await loadRoster();
      const person = findByName(roster, name);
      if (!person) {
        res.status(400).json({ error: 'Ce nom ne figure pas dans le personnel RH' });
        return;
      }

      // Un nom = un seul compte (sauf remplacement de SA propre liaison).
      const taken = await sql(
        'SELECT 1 FROM conges_profiles WHERE lower(name) = lower($1) AND uid <> $2',
        [person.name, user.uid]
      );
      if (taken.length > 0) {
        res.status(409).json({ error: 'Ce nom est déjà associé à un autre compte — contactez un admin' });
        return;
      }

      const config = overrides.config || await loadConfig(sql);
      const emailMatch = !!(person.email && user.email &&
        person.email.toLowerCase() === user.email.toLowerCase());
      const bootstrap = BOOTSTRAP_ADMIN_EMAILS.includes(user.email) &&
        isGlobalAdmin(person.name, config);
      const status = emailMatch || bootstrap ? 'approved' : 'pending';

      await sql(
        `INSERT INTO conges_profiles (uid, name, email, status, email_verified_match)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (uid) DO UPDATE
           SET name = EXCLUDED.name, email = EXCLUDED.email,
               status = EXCLUDED.status, email_verified_match = EXCLUDED.email_verified_match`,
        [user.uid, person.name, user.email || null, status, emailMatch]
      );
      res.status(200).json({ ok: true, name: person.name, status });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error('profile api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
