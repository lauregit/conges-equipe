import { neon } from '@neondatabase/serverless';
import { ROLES } from '../src/constants.js';

// Roster API backed by the conges_employees table.
//   GET                -> full roster (active + inactive), ordered by team, name
//   POST {actor, employee:{id?, name, email, team, role, active}}
//                      -> upsert one person; only an active admin may call it.
//
// Identity is the best-effort name-pick model used across the app: the actor
// is a name that must match an active admin row in the DB.

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

const SELECT = `
  SELECT id::text, name, email, team, role, active
  FROM conges_employees
`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      const rows = await sql(SELECT + ' ORDER BY team, name');
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
      const { actor, employee } = body;
      if (!actor || !employee) {
        res.status(400).json({ error: 'actor et employee sont requis' });
        return;
      }

      // Only an active admin can edit the roster.
      const admins = await sql(
        `SELECT 1 FROM conges_employees WHERE name = $1 AND role = 'admin' AND active`,
        [actor]
      );
      if (admins.length === 0) {
        res.status(403).json({ error: 'Seul un administrateur peut modifier l’équipe' });
        return;
      }

      const name = String(employee.name || '').trim();
      const team = String(employee.team || 'Marketing').trim() || 'Marketing';
      const role = employee.role || 'employee';
      const email = String(employee.email || '').trim() || null;
      const active = employee.active !== false;

      if (!name) {
        res.status(400).json({ error: 'Le nom est requis' });
        return;
      }
      if (!ROLES.includes(role)) {
        res.status(400).json({ error: 'Rôle invalide' });
        return;
      }
      if (email && !EMAIL_RE.test(email)) {
        res.status(400).json({ error: 'Email invalide' });
        return;
      }

      if (employee.id) {
        // A rename must not collide with another row's UNIQUE(name).
        const dupes = await sql(
          `SELECT 1 FROM conges_employees WHERE name = $1 AND id <> $2`,
          [name, employee.id]
        );
        if (dupes.length > 0) {
          res.status(409).json({ error: 'Ce nom existe déjà dans l’équipe' });
          return;
        }
        const rows = await sql(
          `UPDATE conges_employees
           SET name = $2, email = $3, team = $4, role = $5, active = $6
           WHERE id = $1
           RETURNING id::text, name, email, team, role, active`,
          [employee.id, name, email, team, role, active]
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Personne introuvable' });
          return;
        }
        res.status(200).json(rows[0]);
      } else {
        const rows = await sql(
          `INSERT INTO conges_employees (name, email, team, role, active)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name) DO UPDATE
             SET email = EXCLUDED.email, team = EXCLUDED.team,
                 role = EXCLUDED.role, active = EXCLUDED.active
           RETURNING id::text, name, email, team, role, active`,
          [name, email, team, role, active]
        );
        res.status(201).json(rows[0]);
      }
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error('employees api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
