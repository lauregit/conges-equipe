import { neon } from '@neondatabase/serverless';
import { LEAVE_TYPES } from '../src/constants.js';
import { initialStatus, canDecide, canDecideLeave, isSpecialRequest, canSee, isGlobalAdmin } from '../src/leavePolicy.js';
import { normName, findByName, sameName } from '../src/utils/names.js';
import { loadRoster } from './_rhroster.js';
import { requireProfile } from './_auth.js';
import { loadConfig } from './_config.js';

// Congés dans Neon Postgres. SÉCURISÉ :
// - chaque requête exige le jeton de session (identité vérifiée par
//   signature — jamais tirée du corps de la requête)
// - GET : chacun reçoit SES congés en clair + ceux de son SOUS-ARBRE
//   (chaîne de commandement) ; pour les autres, seulement des lignes
//   minimales approuvées (présence/calendrier, sans type ni note).
//   Les admins globaux voient tout.
// - POST : la demande part chez le superviseur RH désigné (policy serveur)
// - PATCH : seul un approbateur désigné décide ; garde atomique
// - DELETE : propriétaire ou admin global

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

// Fusion roster RH + chaîne de commandement (comme /api/roster).
async function loadFullRoster(sql, overrides) {
  const [items, hierarchy] = await Promise.all([
    overrides.roster ? Promise.resolve(overrides.roster) : loadRoster(),
    overrides.roster ? Promise.resolve([]) : sql(`SELECT employee, supervisor, rh_supervisor FROM conges_hierarchy`),
  ]);
  if (overrides.roster) return items;
  const byEmployee = new Map(hierarchy.map(h => [normName(h.employee), h]));
  return items.map(e => {
    const h = byEmployee.get(normName(e.name));
    return { ...e, supervisor: h?.supervisor || null, rhSupervisor: h?.rh_supervisor || null };
  });
}

export default async function handler(req, res, overrides = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const sql = overrides.sql || getSql();
    const me = await requireProfile(req, res, sql, overrides.verify);
    if (!me) return;
    const actor = me.name;

    const config = overrides.config || await loadConfig(sql);

    if (req.method === 'GET') {
      const rows = await sql(SELECT + ' ORDER BY start_date, id');
      const roster = await loadFullRoster(sql, overrides);
      const scoped = rows
        .map(l => {
          if (canSee(actor, l.employee, roster, config)) return l;
          // Hors périmètre : silhouette minimale (présence/calendrier),
          // uniquement les congés approuvés, sans type ni note.
          if (l.status !== 'approved') return null;
          return {
            id: l.id, employee: l.employee, startDate: l.startDate,
            endDate: l.endDate, status: 'approved', type: null, note: null,
            submittedBy: null, decidedBy: null, createdAt: null, restricted: true,
          };
        })
        .filter(Boolean);
      res.status(200).json(scoped);
      return;
    }

    if (req.method === 'POST') {
      const body = parseBody(req, res);
      if (!body) return;
      const { startDate, endDate, type } = body;
      const employee = body.employee || actor;

      if (!startDate || !endDate || !type) {
        res.status(400).json({ error: 'dates et type sont requis' });
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

      const roster = await loadFullRoster(sql, overrides);
      if (!findByName(roster, employee)) {
        res.status(400).json({ error: 'Employé inconnu du personnel RH' });
        return;
      }
      // Saisie pour autrui : réservé à son approbateur ou à un admin global.
      if (!sameName(actor, employee) &&
          !canDecide(actor, employee, roster, config) && !isGlobalAdmin(actor, config)) {
        res.status(403).json({ error: 'Vous ne pouvez pas saisir pour cette personne' });
        return;
      }

      const note = (body.note || '').trim().slice(0, MAX_NOTE) || null;
      // Demande spéciale (> 2 semaines) : reste en attente et n'est validable que par la
      // direction — sauf si c'est justement un admin global qui la saisit.
      const special = isSpecialRequest({ startDate, endDate, type });
      let status = initialStatus({ type, employee, submittedBy: actor }, roster, config);
      if (special && !isGlobalAdmin(actor, config)) status = 'pending';
      const decided = status === 'approved' && !sameName(actor, employee);

      const rows = await sql(
        `INSERT INTO conges_leaves
           (employee, start_date, end_date, type, note, status, submitted_by, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE NOW() END)
         RETURNING id::text`,
        [employee, startDate, endDate, type, note, status, actor, decided ? actor : null]
      );
      res.status(201).json({ id: rows[0].id, status, special });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query?.id;
      const body = parseBody(req, res);
      if (!body) return;
      const { action } = body;

      if (!id || !['approve', 'reject'].includes(action)) {
        res.status(400).json({ error: 'id et action (approve|reject) sont requis' });
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

      const roster = await loadFullRoster(sql, overrides);
      if (!canDecideLeave(actor, leave, roster, config)) {
        const msg = isSpecialRequest(leave)
          ? 'Demande spéciale (plus de 2 semaines) : validation réservée à la direction (Laure/Yoann).'
          : 'Seul le superviseur RH désigné peut décider cette demande';
        res.status(403).json({ error: msg });
        return;
      }

      const status = action === 'approve' ? 'approved' : 'rejected';
      const updated = await sql(
        `UPDATE conges_leaves SET status = $2, decided_by = $3, decided_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id, status, actor]
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
      if (!id) {
        res.status(400).json({ error: 'id requis' });
        return;
      }
      const rows = await sql('SELECT employee FROM conges_leaves WHERE id = $1', [id]);
      if (rows.length === 0) {
        res.status(200).json({ ok: true }); // déjà supprimé — idempotent
        return;
      }
      if (!sameName(actor, rows[0].employee) && !isGlobalAdmin(actor, config)) {
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
