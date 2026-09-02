import { neon } from '@neondatabase/serverless';
import { LEAVE_TYPES, RESTRICTED_SUBMIT_TYPES, DECLARED_TYPES } from '../src/constants.js';
import { initialStatus, canDecide, canDecideLeave, isSpecialRequest, canSee, isGlobalAdmin, approversForNotification, replacementPartners, replacementConflicts, ABSENCE_TYPES } from '../src/leavePolicy.js';
import { findByName, sameName } from '../src/utils/names.js';
import { RESTRICTED_TYPE_HR_EMAILS } from '../src/employees.js';
import { loadRoster } from './_rhroster.js';
import { requireProfile } from './_auth.js';
import { loadConfig, BOOTSTRAP_ADMIN_EMAILS } from './_config.js';
import { sendEmail, requestEmail, decisionEmail, directorsFyiEmail } from './_notify.js';
import { decisionRecipients } from './_recipients.js';

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

// Roster complet : personnel + organigramme, tout vient de la base RH
// partagée (rh_entities + rh_org) via loadRoster — voir _rhroster.js.
async function loadFullRoster(overrides) {
  return overrides.roster ? overrides.roster : loadRoster();
}

// Emails (annuaire RH) d'une liste de noms, en excluant `except` (souvent
// l'auteur de l'action, déjà au courant) et les entrées sans email connu.
function emailsFor(names, roster, except) {
  const skip = except ? sameName.bind(null, except) : () => false;
  return [...new Set(
    (names || [])
      .filter(n => !skip(n))
      .map(n => findByName(roster, n)?.email)
      .filter(Boolean)
      .map(e => e.toLowerCase())
  )];
}

// À la CRÉATION d'un congé :
// - en attente  -> email "à valider" aux VRAIS décideurs (approversForNotification :
//   n'inclut la direction que quand elle est la seule option, ex. le
//   responsable d'équipe demande son propre congé).
// - validé d'office (déclaré, ou saisi par un manager/la RH pour autrui)
//   -> email d'information au(x) manager(s)/RH concerné(s) + à la direction
//   systématiquement (visibilité — demande de Laure : direction informée
//   de TOUT congé validé, quel que soit le type ou qui l'a saisi).
async function notifyOnCreate(leave, { actor, actorEmail, roster, config, send = sendEmail }) {
  if (leave.status === 'pending') {
    const to = decisionRecipients(leave.employee, roster, config);
    if (to.length) await send({ to, ...requestEmail(leave, 'pending') });
    return;
  }
  const mode = DECLARED_TYPES.includes(leave.type) ? 'declared' : 'recorded';
  const informNames = approversForNotification(leave.employee, roster, config);
  const to = new Set(emailsFor(informNames, roster, null));
  for (const email of BOOTSTRAP_ADMIN_EMAILS) to.add(email.toLowerCase());
  // L'auteur n'a pas besoin d'un email pour sa propre action — exclu par
  // son email de session ET par son email RH (peuvent différer : profil lié
  // malgré un email de connexion ≠ email RH, cas géré en Admin).
  if (actorEmail) to.delete(actorEmail.toLowerCase());
  for (const email of emailsFor([actor], roster, null)) to.delete(email);
  if (to.size) await send({ to: [...to], ...requestEmail(leave, mode) });
}

// À la DÉCISION : toujours informer le demandeur ; en cas d'APPROBATION,
// informer aussi systématiquement la direction (visibilité).
async function notifyOnDecide(leave, action, decidedBy, decidedByEmail, roster, send = sendEmail) {
  const requesterEmail = findByName(roster, leave.employee)?.email;
  if (requesterEmail && !sameName(decidedBy, leave.employee)) {
    await send({ to: requesterEmail, ...decisionEmail(leave, action, decidedBy) });
  }
  if (action === 'approve') {
    const to = BOOTSTRAP_ADMIN_EMAILS.filter(e => e.toLowerCase() !== (decidedByEmail || '').toLowerCase());
    if (to.length) await send({ to, ...directorsFyiEmail(leave, decidedBy) });
  }
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
      const roster = await loadFullRoster(overrides);
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

      const roster = await loadFullRoster(overrides);
      if (!findByName(roster, employee)) {
        res.status(400).json({ error: 'Employé inconnu du personnel RH' });
        return;
      }
      // RH désignée (email — voir employees.js) : habilitée à saisir congé
      // sans solde / arrêt maladie pour N'IMPORTE QUI, même hors de sa
      // chaîne d'approbation habituelle (elle n'a pas vocation à approuver
      // les autres types de congé).
      const isRestrictedHR = RESTRICTED_SUBMIT_TYPES.includes(type) &&
        RESTRICTED_TYPE_HR_EMAILS.includes((me.email || '').toLowerCase());

      // Saisie pour autrui : réservé à son approbateur, à un admin global,
      // ou à la RH désignée ci-dessus pour les deux types restreints.
      if (!sameName(actor, employee) &&
          !canDecide(actor, employee, roster, config) && !isGlobalAdmin(actor, config) && !isRestrictedHR) {
        res.status(403).json({ error: 'Vous ne pouvez pas saisir pour cette personne' });
        return;
      }

      // Congé sans solde / arrêt maladie : jamais en libre-service, y
      // compris pour SOI-même — réservé au responsable qui peut décider
      // pour cette personne (son manager), à un admin global, ou à la RH
      // désignée (canDecide exclut toujours l'auto-décision, donc un
      // manager ne peut pas se l'auto-approuver via cette voie non plus).
      if (RESTRICTED_SUBMIT_TYPES.includes(type) && !isGlobalAdmin(actor, config) && !isRestrictedHR &&
          !(!sameName(actor, employee) && canDecide(actor, employee, roster, config))) {
        res.status(403).json({
          error: 'Congé sans solde et arrêt maladie : saisie réservée à votre responsable d’équipe ou au service RH — vous ne pouvez pas le déclarer vous-même.',
        });
        return;
      }

      // Remplaçants (organigramme partagé rh_org) : une personne et son
      // remplaçant ne peuvent pas être absents en même temps — sinon plus
      // personne pour couvrir le poste. Seul un admin global peut forcer.
      if (ABSENCE_TYPES.includes(type) && !isGlobalAdmin(actor, config) &&
          replacementPartners(employee, roster).length > 0) {
        const others = await sql(
          SELECT + ` WHERE status <> 'rejected' AND end_date >= $1 AND start_date <= $2`,
          [startDate, endDate]
        );
        const conflicts = replacementConflicts({ employee, startDate, endDate, type }, roster, others);
        if (conflicts.length > 0) {
          const c = conflicts[0];
          res.status(409).json({
            error: `Conflit de remplacement : ${c.employee} est déjà absent(e) du ${c.startDate} au ${c.endDate}. ` +
              `Vous êtes mutuellement remplaçants — vous ne pouvez pas être absents en même temps. ` +
              `Contactez la direction si c'est indispensable.`,
          });
          return;
        }
      }

      const note = (body.note || '').trim().slice(0, MAX_NOTE) || null;
      // Demande spéciale (> 2 semaines) : reste en attente et n'est validable que par la
      // direction — sauf si c'est justement un admin global qui la saisit.
      const special = isSpecialRequest({ startDate, endDate, type });
      let status = initialStatus({ type, employee, submittedBy: actor }, roster, config);
      // La RH désignée (RESTRICTED_TYPE_HR_EMAILS) validant d'office comme
      // le ferait n'importe quel manager saisissant pour son équipe — même
      // quand elle n'est pas dans la chaîne d'approbation habituelle de
      // cette personne (initialStatus ne le sait pas, elle raisonne par nom).
      if (RESTRICTED_SUBMIT_TYPES.includes(type) && isRestrictedHR && !sameName(actor, employee)) {
        status = 'approved';
      }
      if (special && !isGlobalAdmin(actor, config)) status = 'pending';
      const decided = status === 'approved' && !sameName(actor, employee);

      const rows = await sql(
        `INSERT INTO conges_leaves
           (employee, start_date, end_date, type, note, status, submitted_by, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE NOW() END)
         RETURNING id::text`,
        [employee, startDate, endDate, type, note, status, actor, decided ? actor : null]
      );

      // Emails — best-effort : ATTENDU (une fonction serverless peut être
      // arrêtée juste après la réponse, un envoi "fire-and-forget" non
      // attendu risquerait de ne jamais partir) mais son échec ne fait
      // jamais échouer la requête (l'enregistrement du congé est déjà fait).
      const newLeave = { id: rows[0].id, employee, startDate, endDate, type, note, status };
      try {
        await notifyOnCreate(newLeave, { actor, actorEmail: me.email, roster, config, send: overrides.sendEmail });
      } catch (err) { console.error('notify create failed:', err); }

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

      const roster = await loadFullRoster(overrides);
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

      // Emails — best-effort (attendu, voir commentaire POST plus haut).
      try {
        await notifyOnDecide({ ...leave, status }, action, actor, me.email, roster, overrides.sendEmail);
      } catch (err) { console.error('notify decide failed:', err); }

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
