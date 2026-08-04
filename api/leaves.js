import { neon } from '@neondatabase/serverless';
import { LEAVE_TYPES } from '../src/constants.js';
import { initialStatus, canDecide } from '../src/leavePolicy.js';
import { GLOBAL_SUPER_ADMINS } from '../src/employees.js';
import { normName, findByName, sameName } from '../src/utils/names.js';
import { loadRoster } from './_rhroster.js';

// Congés dans Neon Postgres (table conges_leaves) — la base de Yoann.
// Le personnel/organigramme vient de RH Compliance (loadRoster) et sert à
// APPLIQUER la policy côté serveur : statut initial, droits de décision.
// Routes (toutes sur /api/leaves) :
//   GET                          -> tous les congés
//   POST  {employee, submittedBy, startDate, endDate, type, note}
//         -> pending/approved selon la policy (organigramme)
//   PATCH ?id=  {user, action:'approve'|'reject'}
//         -> décision manager (UPDATE atomique, une seule décision gagne)
//   DELETE ?id=&user=            -> propriétaire ou admin global
//
// Identité best-effort (nom fourni par le client, validé contre le roster) —
// même modèle de confiance que le reste de l'app interne.

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

// Vraie date calendaire 'yyyy-MM-dd' (rejette p.ex. 2026-02-31).
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
         submitted_by AS "submittedBy",
         decided_by   AS "decidedBy",
         to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "createdAt"
  FROM conges_leaves
`;

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

const isGlobalAdmin = (name) =>
  GLOBAL_SUPER_ADMINS.some(a => normName(a) === normName(name));

// `sqlOverride`/`rosterOverride` ne sont passés que par les tests.
export default async function handler(req, res, sqlOverride, rosterOverride) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
      const body = parseBody(req, res);
      if (!body) return;
      const { employee, startDate, endDate, type } = body;
      const submittedBy = body.submittedBy || employee;

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

      const roster = rosterOverride || await loadRoster();
      if (!findByName(roster, employee)) {
        res.status(400).json({ error: 'Employé inconnu du personnel RH' });
        return;
      }
      // Seul un approbateur (ou soi-même) peut saisir pour quelqu'un.
      if (!sameName(submittedBy, employee) &&
          !canDecide(submittedBy, employee, roster) && !isGlobalAdmin(submittedBy)) {
        res.status(403).json({ error: 'Vous ne pouvez pas saisir pour cette personne' });
        return;
      }

      const note = (body.note || '').trim().slice(0, MAX_NOTE) || null;
      const status = initialStatus({ type, employee, submittedBy }, roster);
      const decided = status === 'approved' && !sameName(submittedBy, employee);

      const rows = await sql(
        `INSERT INTO conges_leaves
           (employee, start_date, end_date, type, note, status, submitted_by, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE NOW() END)
         RETURNING id::text`,
        [employee, startDate, endDate, type, note, status, submittedBy, decided ? submittedBy : null]
      );
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

      const roster = rosterOverride || await loadRoster();
      if (!canDecide(user, leave.employee, roster)) {
        res.status(403).json({ error: "Seul un manager de l'équipe peut décider cette demande" });
        return;
      }

      const status = action === 'approve' ? 'approved' : 'rejected';
      // Garde atomique : deux décisions concurrentes -> une seule gagne.
      const updated = await sql(
        `UPDATE conges_leaves SET status = $2, decided_by = $3, decided_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id, status, user]
      );
      if (updated.length === 0) {
        res.status(409).json({ error: 'Cette demande a déjà été traitée' });
        return;
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
        // Déjà supprimé — succès idempotent.
        res.status(200).json({ ok: true });
        return;
      }
      if (!user || (!sameName(user, rows[0].employee) && !isGlobalAdmin(user))) {
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
