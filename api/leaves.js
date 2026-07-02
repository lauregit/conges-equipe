import { neon } from '@neondatabase/serverless';
import { LEAVE_TYPES, DECLARED_TYPES } from '../src/constants.js';
import { sendEmail, requestEmail, decisionEmail } from './_notify.js';

// Serverless function backing the leave calendar (Neon Postgres).
// Routes (all on /api/leaves):
//   GET                        -> every leave with its status
//   POST  {employee,startDate,endDate,type,note}
//         -> maladie is DECLARED (auto-approved, managers notified FYI);
//            other types create a PENDING request (managers notified to act)
//   PATCH ?id=<id>  {user, action:'approve'|'reject'}
//         -> decide a pending request (team manager or admin only)
//   DELETE ?id=<id>&user=<name> -> owner or admin only
//
// The endpoint is public (internal tool, name-pick identity), so every write
// is validated server-side against the conges_employees roster in the DB.
// Dates are 'yyyy-MM-dd' strings end to end.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 200;

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
         status,
         decided_by AS "decidedBy",
         to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "createdAt"
  FROM conges_leaves
`;

// Emails of the people who should hear about a team's requests: the team's
// active managers, plus active admins (they can approve anything).
async function approverEmails(sql, team) {
  const rows = await sql(
    `SELECT email FROM conges_employees
     WHERE active AND email IS NOT NULL
       AND (role = 'admin' OR (role = 'manager' AND team = $1))`,
    [team]
  );
  return rows.map(r => r.email);
}

function parseBody(req, res) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      res.status(400).json({ error: 'JSON invalide' });
      return null;
    }
  }
  return req.body || {};
}

// `sqlOverride`/`notifyOverride` are only passed by unit tests.
export default async function handler(req, res, sqlOverride, notifyOverride) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const sql = sqlOverride || getSql();
    const notify = notifyOverride || sendEmail;

    if (req.method === 'GET') {
      const rows = await sql(SELECT + ' ORDER BY start_date, id');
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const body = parseBody(req, res);
      if (!body) return;
      const { employee, startDate, endDate, type } = body;

      if (!employee || !startDate || !endDate || !type) {
        res.status(400).json({ error: 'employé, dates et type sont requis' });
        return;
      }
      if (body.note != null && typeof body.note !== 'string') {
        res.status(400).json({ error: 'La note doit être du texte' });
        return;
      }
      if (!LEAVE_TYPES.includes(type)) {
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

      const emp = (await sql(
        `SELECT name, team FROM conges_employees WHERE name = $1 AND active`,
        [employee]
      ))[0];
      if (!emp) {
        res.status(400).json({ error: 'Employé inconnu' });
        return;
      }

      const note = (body.note || '').trim().slice(0, MAX_NOTE) || null;
      const declared = DECLARED_TYPES.includes(type);

      // Approval is OPT-IN per team: a request only goes pending when the
      // team has an active manager to decide it. With no manager configured
      // the historic behavior is kept — the leave is recorded immediately.
      const managers = declared ? [] : await sql(
        `SELECT 1 FROM conges_employees WHERE role = 'manager' AND team = $1 AND active`,
        [emp.team]
      );
      const needsApproval = !declared && managers.length > 0;
      const status = needsApproval ? 'pending' : 'approved';

      const rows = await sql(
        `INSERT INTO conges_leaves (employee, start_date, end_date, type, note, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
        [employee, startDate, endDate, type, note, status]
      );

      // Best-effort notification to the team's approvers.
      const to = await approverEmails(sql, emp.team);
      if (to.length > 0) {
        const leave = { employee, startDate, endDate, type, note };
        const mode = declared ? 'declared' : needsApproval ? 'pending' : 'recorded';
        await notify({ to, ...requestEmail(leave, mode) });
      }

      res.status(201).json({ id: rows[0].id, status });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query?.id;
      const body = parseBody(req, res);
      if (!body) return;
      const { user, action } = body;

      if (!id || !user || !['approve', 'reject'].includes(action)) {
        res.status(400).json({ error: 'id, user et action (approve|reject) sont requis' });
        return;
      }

      const leave = (await sql(SELECT + ' WHERE id = $1', [id]))[0];
      if (!leave) {
        res.status(404).json({ error: 'Demande introuvable' });
        return;
      }
      if (leave.status !== 'pending') {
        res.status(409).json({ error: 'Cette demande a déjà été traitée' });
        return;
      }

      const actor = (await sql(
        `SELECT name, team, role FROM conges_employees WHERE name = $1 AND active`,
        [user]
      ))[0];
      const owner = (await sql(
        `SELECT name, email, team FROM conges_employees WHERE name = $1`,
        [leave.employee]
      ))[0];

      const isAdmin = actor?.role === 'admin';
      const managesTeam = actor?.role === 'manager' && owner && actor.team === owner.team;
      if (!actor || (!isAdmin && !managesTeam)) {
        res.status(403).json({ error: 'Seul un manager de l’équipe ou un admin peut décider' });
        return;
      }
      if (!isAdmin && actor.name === leave.employee) {
        res.status(403).json({ error: 'Vous ne pouvez pas décider votre propre demande' });
        return;
      }

      const status = action === 'approve' ? 'approved' : 'rejected';
      // Atomic guard: only decide if still pending, so two concurrent
      // decisions can't overwrite each other (the loser gets a 409).
      const updated = await sql(
        `UPDATE conges_leaves SET status = $2, decided_by = $3, decided_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id, status, user]
      );
      if (updated.length === 0) {
        res.status(409).json({ error: 'Cette demande a déjà été traitée' });
        return;
      }

      if (owner?.email) {
        await notify({ to: owner.email, ...decisionEmail(leave, action, user) });
      }

      res.status(200).json({ ok: true, status });
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
      if (user !== owner) {
        const admins = user
          ? await sql(`SELECT 1 FROM conges_employees WHERE name = $1 AND role = 'admin' AND active`, [user])
          : [];
        if (admins.length === 0) {
          res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres congés' });
          return;
        }
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
