import { verifySession } from './_session.js';

// Authentification serveur : chaque requête API doit porter le jeton de
// session maison (Authorization: Bearer <token>), signé par api/_session.js
// après validation des identifiants Certilogia. L'identité est DÉRIVÉE du
// jeton — jamais du corps de la requête.

export async function getVerifiedUser(req, verifyOverride) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '');
  if (!m) return null;
  if (verifyOverride) return verifyOverride(m[1]);
  return verifySession(m[1]);
}

// Jeton requis (profil pas encore nécessaire — ex. /api/roster au moment du
// choix du nom). Répond 401 et renvoie null si absent/invalide.
export async function requireToken(req, res, verifyOverride) {
  const user = await getVerifiedUser(req, verifyOverride);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return null;
  }
  return user;
}

// Jeton + profil lié (nom du personnel) requis. Répond 401/403 sinon.
// Renvoie { uid, email, name, status }.
export async function requireProfile(req, res, sql, verifyOverride) {
  const user = await requireToken(req, res, verifyOverride);
  if (!user) return null;
  const rows = await sql('SELECT name, status FROM conges_profiles WHERE uid = $1', [user.uid]);
  if (rows.length === 0) {
    res.status(403).json({ error: 'Profil non configuré — choisissez votre nom' });
    return null;
  }
  if (rows[0].status !== 'approved') {
    res.status(403).json({ error: 'Profil en attente de validation par un admin' });
    return null;
  }
  return { ...user, name: rows[0].name, status: rows[0].status };
}
