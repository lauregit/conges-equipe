import { neon } from '@neondatabase/serverless';
import { loadRoster } from './_rhroster.js';
import { loadConfig } from './_config.js';
import { sendEmail, reminderEmail } from './_notify.js';
import { decisionRecipients } from './_recipients.js';

// Relance automatique (Vercel Cron — voir vercel.json) : toute demande
// encore "pending" plus de 48h après sa création reçoit UNE relance par
// email, adressée aux mêmes destinataires que l'email "à valider" initial
// (decisionRecipients — le(s) vrai(s) décideur(s), avec repli direction).
// `reminded_at` est posé après traitement, qu'un email ait pu partir ou
// non, pour ne relancer chaque demande qu'UNE seule fois (voir
// MIGRATIONS.md pour la migration qui ajoute cette colonne).
const REMINDER_DELAY_HOURS = 48;

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql) _sql = neon(url);
  return _sql;
}

export default async function handler(req, res, overrides = {}) {
  // Vercel envoie `Authorization: Bearer $CRON_SECRET` pour les requêtes
  // cron quand CRON_SECRET est configuré (recommandation officielle
  // Vercel) — évite que n'importe qui puisse déclencher l'envoi en
  // appelant l'URL publiquement. Si CRON_SECRET n'est pas configuré, on ne
  // bloque pas (à définir sur Vercel avant mise en prod — voir README).
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers?.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Non autorisé' });
    return;
  }

  try {
    const sql = overrides.sql || getSql();
    const roster = overrides.roster || (await loadRoster());
    const config = overrides.config || (await loadConfig(sql));
    const send = overrides.sendEmail || sendEmail;

    const rows = await sql(
      `SELECT id::text, employee,
              to_char(start_date, 'YYYY-MM-DD') AS "startDate",
              to_char(end_date,   'YYYY-MM-DD') AS "endDate",
              type, note
       FROM conges_leaves
       WHERE status = 'pending' AND reminded_at IS NULL
         AND created_at < NOW() - INTERVAL '${REMINDER_DELAY_HOURS} hours'`
    );

    let sent = 0;
    for (const leave of rows) {
      const to = decisionRecipients(leave.employee, roster, config);
      if (to.length && (await send({ to, ...reminderEmail(leave) }))) sent++;
      await sql(`UPDATE conges_leaves SET reminded_at = NOW() WHERE id = $1`, [leave.id]);
    }

    res.status(200).json({ checked: rows.length, sent });
  } catch (err) {
    console.error('cron-reminders error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
