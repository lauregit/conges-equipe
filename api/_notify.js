// Email notifications via SendGrid.
// Sender is PINNED to yvalensi@gmail.com — the only verified sender
// (certideal.com is DMARC-rejected until domain auth is set up).
// All sends are best-effort: a failed email never fails the API request.

import { TYPE_META } from '../src/constants.js';

const FROM = { email: 'yvalensi@gmail.com', name: 'Congés Certideal' };
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

// `fetchImpl` is only passed by unit tests.
export async function sendEmail({ to, subject, text }, fetchImpl = fetch) {
  const key = process.env.SENDGRID_API_KEY;
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!key || recipients.length === 0) return false;
  try {
    const res = await fetchImpl(SENDGRID_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: recipients.map(email => ({ email })) }],
        from: FROM,
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (!res.ok) console.error('sendgrid error:', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (err) {
    console.error('sendgrid unreachable:', err);
    return false;
  }
}

const typeLabel = (t) => TYPE_META[t]?.label || t;

function fmtRange(l) {
  return l.startDate === l.endDate ? `le ${l.startDate}` : `du ${l.startDate} au ${l.endDate}`;
}

// New entry -> notify the team's managers and admins that have an email on
// file. mode: 'pending'  = a request awaiting a manager decision
//            'declared'  = sickness declared (FYI, auto-approved)
//            'recorded'  = leave recorded directly (team has no manager — FYI)
export function requestEmail(leave, mode) {
  const type = typeLabel(leave.type);
  const noteLine = leave.note ? `\nNote : ${leave.note}` : '';
  const link = '\n\nCalendrier : https://conges-equipe-beryl.vercel.app';
  if (mode === 'declared') {
    return {
      subject: `[Congés] Absence déclarée — ${leave.employee}`,
      text: `${leave.employee} a déclaré une absence (${type}) ${fmtRange(leave)}.${noteLine}${link}`,
    };
  }
  if (mode === 'recorded') {
    return {
      subject: `[Congés] Congé enregistré — ${leave.employee}`,
      text: `${leave.employee} a posé un congé (${type}) ${fmtRange(leave)}.${noteLine}${link}`,
    };
  }
  return {
    subject: `[Congés] Demande à approuver — ${leave.employee}`,
    text: `${leave.employee} demande un congé (${type}) ${fmtRange(leave)}.${noteLine}` +
      `\n\nÀ approuver ou refuser ici : https://conges-equipe-beryl.vercel.app`,
  };
}

// Decision taken -> notify the requester.
export function decisionEmail(leave, action, decidedBy) {
  const type = typeLabel(leave.type);
  const verdict = action === 'approve' ? 'APPROUVÉE ✓' : 'REFUSÉE ✗';
  return {
    subject: `[Congés] Votre demande a été ${action === 'approve' ? 'approuvée' : 'refusée'}`,
    text: `Votre demande de congé (${type}) ${fmtRange(leave)} a été ${verdict} par ${decidedBy}.` +
      `\n\nCalendrier : https://conges-equipe-beryl.vercel.app`,
  };
}
