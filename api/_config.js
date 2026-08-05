import { EXTRA_APPROVERS, GLOBAL_SUPER_ADMINS } from '../src/employees.js';

// Configuration des rôles, stockée en base (conges_settings, clé 'config')
// et éditable depuis l'onglet Admin. src/employees.js ne sert plus que de
// SEED au premier chargement.
//
// Forme : { globalAdmins: [names], extraApprovers: { [pôle]: [names] } }
//
// bootstrapAdminEmails : emails dont le compte est TOUJOURS admin global,
// même sans profil validé par quelqu'un d'autre (amorçage du système —
// sinon personne ne pourrait approuver le premier admin).

export const BOOTSTRAP_ADMIN_EMAILS = ['yoann@certideal.com', 'laure@certideal.com'];

const SEED = {
  globalAdmins: GLOBAL_SUPER_ADMINS,
  extraApprovers: EXTRA_APPROVERS,
};

export async function loadConfig(sql) {
  const rows = await sql(`SELECT value FROM conges_settings WHERE key = 'config'`);
  if (rows.length === 0) {
    await sql(
      `INSERT INTO conges_settings (key, value) VALUES ('config', $1)
       ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(SEED)]
    );
    return { ...SEED };
  }
  try {
    const cfg = JSON.parse(rows[0].value);
    return {
      globalAdmins: Array.isArray(cfg.globalAdmins) ? cfg.globalAdmins : SEED.globalAdmins,
      extraApprovers: cfg.extraApprovers && typeof cfg.extraApprovers === 'object'
        ? cfg.extraApprovers : SEED.extraApprovers,
    };
  } catch {
    return { ...SEED };
  }
}

export async function saveConfig(sql, config) {
  await sql(
    `INSERT INTO conges_settings (key, value, updated_at) VALUES ('config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ globalAdmins: config.globalAdmins, extraApprovers: config.extraApprovers })]
  );
}
