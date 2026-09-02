import { approversForNotification } from '../src/leavePolicy.js';
import { findByName, sameName } from '../src/utils/names.js';
import { BOOTSTRAP_ADMIN_EMAILS } from './_config.js';

// Emails à notifier pour une demande "à valider" (ou une relance)
// concernant `employee` : les vrais décideurs (approversForNotification),
// avec un repli GARANTI sur BOOTSTRAP_ADMIN_EMAILS — plutôt que sur leur
// fiche RH Compliance, qui pourrait être absente ou périmée — quand ils
// sont les SEULS décideurs possibles (ex. le responsable d'équipe demande
// son propre congé, ou personne n'est configuré comme approbateur).
// Partagé par api/leaves.js (email "à valider" à la création) et
// api/cron-reminders.js (relance à 48h) pour ne pas dupliquer la règle.
export function decisionRecipients(employee, roster, config) {
  const names = approversForNotification(employee, roster, config);
  const to = new Set(
    names.map(n => findByName(roster, n)?.email).filter(Boolean).map(e => e.toLowerCase())
  );
  const admins = config.globalAdmins || [];
  if (names.length > 0 && names.every(n => admins.some(a => sameName(a, n)))) {
    for (const email of BOOTSTRAP_ADMIN_EMAILS) to.add(email.toLowerCase());
  }
  return [...to];
}
