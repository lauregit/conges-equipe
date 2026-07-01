import { neon } from '@neondatabase/serverless';
import { ALL_EMPLOYEES, LEAVE_TYPES, ADMIN_NAME } from '../src/employees.js';

// Serverless function backing the leave calendar.
// Neon (Postgres) replaces the previous Firebase Firestore `leaves` collection.
// Routes (all on /api/leaves):
//   GET                       -> list every leave, ordered by start date
//   POST  {employee,startDate,endDate,type,note}  -> insert one (validated)
//   DELETE ?id=<id>&user=<name> -> delete one (owner or admin only)
//
// This endpoint is public (CORS *, no token auth by design for an internal
// tool), so all writes are validated server-side: the frontend cannot be
// trusted to be the only caller. start/end dates are stored as DATE and
// returned as 'yyyy-MM-dd' strings so the frontend's string comparisons keep
// working unchanged.

const ROSTER = new Set(ALL_EMPLOYEES);
const TYPES = new Set(LEAVE_TYPES);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 200;

// Cache keyed on the URL so a missing/changed DATABASE_URL is re-evaluated
// (avoids a stale connection surviving env changes, and keeps tests robust).
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

// Strict calendar-date check: correct 'yyyy-MM-dd' shape AND a real date
// (rejects e.g. 2026-02-31, which Date.parse would otherwise roll over).
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const SELECT = `
  SELECT id::text,
         employee,
         to_char(start_date, 'YYYY-MM-DD') AS "startDate",
         to_char(end_date,   'YYYY-MM-DD') AS "endDate",
         type,
         note,
         to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "createdAt"
  FROM conges_leaves
`;

// `sqlOverride` is only passed by unit tests; Vercel calls handler(req, res).
export default async function handler(req, res, sqlOverride) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const sql = sqlOverride || getSql();

    if (req.method === 'GET') {
      const rows = await sql(SELECT + ' ORDER BY start_date, id');
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      let body;
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body || '{}');
        } catch {
          res.status(400).json({ error: 'JSON invalide' });
          return;
        }
      } else {
        body = req.body || {};
      }
      const { employee, startDate, endDate, type } = body;

      if (!employee || !startDate || !endDate || !type) {
        res.status(400).json({ error: 'employé, dates et type sont requis' });
        return;
      }
      if (body.note != null && typeof body.note !== 'string') {
        res.status(400).json({ error: 'La note doit être du texte' });
        return;
      }
      if (!ROSTER.has(employee)) {
        res.status(400).json({ error: 'Employé inconnu' });
        return;
      }
      if (!TYPES.has(type)) {
        res.status(400).json({ error: 'Type de congé invalide' });
        return;
      }
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        res.status(400).json({ error: 'Date invalide' });
        return;
      }
      if (startDate > endDate) {
        res.status(400).json({ error: 'La date de début doit précéder la date de fin' });
        return;
      }
      const note = (body.note || '').trim().slice(0, MAX_NOTE) || null;

      const rows = await sql(
        `INSERT INTO conges_leaves (employee, start_date, end_date, type, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
        [employee, startDate, endDate, type, note]
      );
      res.status(201).json({ id: rows[0].id });
      return;
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id;
      const user = req.query?.user;
      if (!id) {
        res.status(400).json({ error: 'id requis' });
        return;
      }
      const rows = await sql('SELECT employee FROM conges_leaves WHERE id = $1', [id]);
      if (rows.length === 0) {
        // Already gone — treat as success (idempotent delete).
        res.status(200).json({ ok: true });
        return;
      }
      const owner = rows[0].employee;
      if (user !== ADMIN_NAME && user !== owner) {
        res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres congés' });
        return;
      }
      await sql('DELETE FROM conges_leaves WHERE id = $1', [id]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error('leaves api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
