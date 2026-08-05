import { neon } from '@neondatabase/serverless';
import { requireProfile } from './_auth.js';
import { loadConfig, saveConfig, BOOTSTRAP_ADMIN_EMAILS } from './_config.js';
import { loadRoster } from './_rhroster.js';
import { normName, findByName } from '../src/utils/names.js';
import { isGlobalAdmin, chainOf, MAX_CHAIN } from '../src/leavePolicy.js';

// Système d'administration (admins globaux uniquement) :
//   GET  -> { bindings, config, hierarchy }
//   POST {action:'approve-binding'|'reject-binding', uid}
//        {action:'save-config', config:{globalAdmins, extraApprovers}}
//        {action:'set-hierarchy', employee, supervisor, rhSupervisor}
//
// La chaîne de commandement est plafonnée à 5 niveaux et protégée contre
// les cycles à l'écriture.

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql) _sql = neon(url);
  return _sql;
}

export default async function handler(req, res, overrides = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const sql = overrides.sql || getSql();
    const me = await requireProfile(req, res, sql, overrides.verify);
    if (!me) return;

    const config = overrides.config || await loadConfig(sql);
    if (!isGlobalAdmin(me.name, config) && !BOOTSTRAP_ADMIN_EMAILS.includes(me.email)) {
      res.status(403).json({ error: 'Réservé aux admins globaux' });
      return;
    }

    if (req.method === 'GET') {
      const [bindings, hierarchy] = await Promise.all([
        sql(`SELECT uid, name, email, status, email_verified_match AS "emailMatch",
                    to_char(created_at, 'YYYY-MM-DD') AS "createdAt"
             FROM conges_profiles ORDER BY status DESC, name`),
        sql(`SELECT employee, supervisor, rh_supervisor AS "rhSupervisor" FROM conges_hierarchy ORDER BY employee`),
      ]);
      res.status(200).json({ bindings, config, hierarchy });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { action } = body;

      if (action === 'approve-binding' || action === 'reject-binding') {
        if (!body.uid) {
          res.status(400).json({ error: 'uid requis' });
          return;
        }
        if (action === 'approve-binding') {
          await sql(`UPDATE conges_profiles SET status = 'approved' WHERE uid = $1`, [body.uid]);
        } else {
          await sql(`DELETE FROM conges_profiles WHERE uid = $1`, [body.uid]);
        }
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'save-config') {
        const cfg = body.config || {};
        if (!Array.isArray(cfg.globalAdmins) || cfg.globalAdmins.length === 0) {
          res.status(400).json({ error: 'globalAdmins : liste non vide requise' });
          return;
        }
        // Garde-fou : un admin ne peut pas se retirer lui-même (lock-out).
        if (!cfg.globalAdmins.some(a => normName(a) === normName(me.name))) {
          res.status(400).json({ error: 'Vous ne pouvez pas vous retirer des admins globaux' });
          return;
        }
        await saveConfig(sql, {
          globalAdmins: cfg.globalAdmins.map(s => String(s).trim()).filter(Boolean),
          extraApprovers: cfg.extraApprovers && typeof cfg.extraApprovers === 'object' ? cfg.extraApprovers : {},
        });
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'set-hierarchy') {
        const employee = String(body.employee || '').trim();
        const supervisor = String(body.supervisor || '').trim() || null;
        const rhSupervisor = String(body.rhSupervisor || '').trim() || null;
        if (!employee) {
          res.status(400).json({ error: 'employee requis' });
          return;
        }
        const roster = overrides.roster || await loadRoster();
        for (const [label, v] of [['employee', employee], ['supervisor', supervisor], ['rhSupervisor', rhSupervisor]]) {
          if (v && !findByName(roster, v)) {
            res.status(400).json({ error: `${label} : « ${v} » ne figure pas dans le personnel RH` });
            return;
          }
        }
        if (supervisor && normName(supervisor) === normName(employee)) {
          res.status(400).json({ error: 'Une personne ne peut pas être son propre superviseur' });
          return;
        }
        // Anti-cycle + plafond 5 niveaux : simule la chaîne avec la nouvelle arête.
        if (supervisor) {
          const hierarchy = await sql(`SELECT employee, supervisor FROM conges_hierarchy`);
          const simulated = roster.map(r => {
            const h = hierarchy.find(x => normName(x.employee) === normName(r.name));
            const sup = normName(r.name) === normName(employee) ? supervisor : (h?.supervisor || null);
            return { ...r, supervisor: sup };
          });
          const chain = chainOf(employee, simulated);
          if (chain.some(n => normName(n) === normName(employee))) {
            res.status(400).json({ error: 'Cycle détecté dans la chaîne de commandement' });
            return;
          }
          if (chain.length > MAX_CHAIN) {
            res.status(400).json({ error: `Chaîne limitée à ${MAX_CHAIN} niveaux` });
            return;
          }
        }
        if (!supervisor && !rhSupervisor) {
          await sql(`DELETE FROM conges_hierarchy WHERE lower(employee) = lower($1)`, [employee]);
        } else {
          await sql(
            `INSERT INTO conges_hierarchy (employee, supervisor, rh_supervisor, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (employee) DO UPDATE
               SET supervisor = EXCLUDED.supervisor, rh_supervisor = EXCLUDED.rh_supervisor, updated_at = NOW()`,
            [findByName(roster, employee).name, supervisor, rhSupervisor]
          );
        }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'action inconnue' });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error('admin api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
