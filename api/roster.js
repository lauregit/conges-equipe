import { neon } from '@neondatabase/serverless';
import { loadRoster } from './_rhroster.js';
import { requireToken } from './_auth.js';
import { loadConfig } from './_config.js';
import { normName } from '../src/utils/names.js';

// Personnel (RH Compliance) + chaîne de commandement (conges_hierarchy,
// éditée en Admin) + config des rôles. Connexion requise : l'annuaire ne
// doit pas être public.

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql) _sql = neon(url);
  return _sql;
}

export default async function handler(req, res, overrides = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const user = await requireToken(req, res, overrides.verify);
    if (!user) return;

    const sql = overrides.sql || getSql();
    const [items, hierarchy, config] = await Promise.all([
      overrides.roster ? Promise.resolve(overrides.roster) : loadRoster(),
      sql(`SELECT employee, supervisor, rh_supervisor FROM conges_hierarchy`),
      loadConfig(sql),
    ]);

    const byEmployee = new Map(hierarchy.map(h => [normName(h.employee), h]));
    const merged = items.map(e => {
      const h = byEmployee.get(normName(e.name));
      return { ...e, supervisor: h?.supervisor || null, rhSupervisor: h?.rh_supervisor || null };
    });

    res.status(200).json({ items: merged, config });
  } catch (err) {
    console.error('roster api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
