import { neon } from '@neondatabase/serverless';

// Profils de connexion (uid Firebase -> nom du personnel), stockés dans Neon
// (table conges_profiles). Remplace la collection Firestore `users`.
//   GET  ?uid=            -> { name, email } | 404
//   POST {uid, name, email} -> upsert

let _sql;
let _sqlUrl;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql || url !== _sqlUrl) {
    _sql = neon(url);
    _sqlUrl = url;
  }
  return _sql;
}

export default async function handler(req, res, sqlOverride) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const sql = sqlOverride || getSql();

    if (req.method === 'GET') {
      const uid = req.query?.uid;
      if (!uid) {
        res.status(400).json({ error: 'uid requis' });
        return;
      }
      const rows = await sql('SELECT name, email FROM conges_profiles WHERE uid = $1', [uid]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Profil introuvable' });
        return;
      }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { uid, name } = body;
      const email = body.email || null;
      if (!uid || !name) {
        res.status(400).json({ error: 'uid et name sont requis' });
        return;
      }
      await sql(
        `INSERT INTO conges_profiles (uid, name, email) VALUES ($1, $2, $3)
         ON CONFLICT (uid) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email`,
        [uid, String(name).trim(), email]
      );
      res.status(200).json({ ok: true, name, email });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error('profile api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
