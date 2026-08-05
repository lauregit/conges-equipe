import { neon } from '@neondatabase/serverless';
import { loadRoster } from './_rhroster.js';
import { requireToken } from './_auth.js';
import { loadConfig } from './_config.js';

// Personnel + organigramme : tout vient de la base RH Compliance partagée
// (rh_entities + rh_org — voir _rhroster.js). La chaîne de commandement,
// le validateur congés et les remplaçants sont ÉDITABLES DES DEUX CÔTÉS
// (Admin ici, page « Organigramme & Remplaçants » dans RH Compliance).
// Connexion requise : l'annuaire ne doit pas être public.

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
    const [items, config] = await Promise.all([
      overrides.roster ? Promise.resolve(overrides.roster) : loadRoster(),
      loadConfig(sql),
    ]);

    res.status(200).json({ items, config });
  } catch (err) {
    console.error('roster api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
