import { neon } from '@neondatabase/serverless';
import { GLOBAL_SUPER_ADMINS } from '../src/employees.js';
import { LEAVE_TYPES } from '../src/constants.js';
import { normName } from '../src/utils/names.js';

// Import ONE-SHOT des congés Firestore vers Neon.
// Les règles Firestore n'autorisent que les sessions de l'app : c'est donc le
// NAVIGATEUR d'un admin global (bouton « Importer depuis Firestore » de
// l'onglet Équipes) qui lit Firestore et poste les documents ici.
// Idempotent : chaque doc porte son firestore_id (UNIQUE) — re-cliquer ne
// duplique rien.

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql) _sql = neon(url);
  return _sql;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OK_STATUS = ['pending', 'approved', 'rejected'];

export default async function handler(req, res, sqlOverride) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { actor, leaves } = body;

    if (!actor || !GLOBAL_SUPER_ADMINS.some(a => normName(a) === normName(actor))) {
      res.status(403).json({ error: 'Réservé aux admins globaux' });
      return;
    }
    if (!Array.isArray(leaves) || leaves.length === 0 || leaves.length > 2000) {
      res.status(400).json({ error: 'leaves: tableau de 1 à 2000 éléments requis' });
      return;
    }

    const sql = sqlOverride || getSql();
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const l of leaves) {
      const ok = l && l.firestoreId && l.employee &&
        DATE_RE.test(l.startDate || '') && DATE_RE.test(l.endDate || '') &&
        LEAVE_TYPES.includes(l.type);
      if (!ok) {
        errors.push(l?.firestoreId || '(sans id)');
        continue;
      }
      const status = OK_STATUS.includes(l.status) ? l.status : 'approved';
      const rows = await sql(
        `INSERT INTO conges_leaves
           (firestore_id, employee, start_date, end_date, type, note, status,
            submitted_by, decided_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()))
         ON CONFLICT (firestore_id) DO NOTHING
         RETURNING id`,
        [
          String(l.firestoreId), String(l.employee), l.startDate, l.endDate, l.type,
          (l.note || '').slice(0, 200) || null, status,
          l.submittedBy || null, l.decidedBy || null, l.createdAt || null,
        ]
      );
      if (rows.length > 0) imported++;
      else skipped++;
    }

    res.status(200).json({ ok: true, imported, skipped, invalid: errors.length, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error('import-firestore error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
