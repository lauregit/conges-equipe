import { loadRoster } from './_rhroster.js';

// Personnel officiel + organigramme, lu depuis la base RH Compliance.
// Logique partagée dans api/_rhroster.js (utilisée aussi par /api/leaves
// pour valider les écritures côté serveur).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const items = await loadRoster();
    // Le roster bouge rarement : cache CDN 5 min pour épargner la base RH.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ items });
  } catch (err) {
    console.error('roster api error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
