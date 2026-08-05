import { createRemoteJWKSet, jwtVerify } from 'jose';

// Authentification serveur : chaque requête API doit porter le jeton de
// session Firebase (Authorization: Bearer <idToken>) — présent pour TOUS les
// utilisateurs connectés (connexion Certilogia comprise, via le compte
// miroir). Le jeton est vérifié par signature (JWKS Google), l'identité est
// DÉRIVÉE du jeton — jamais du corps de la requête.

const PROJECT_ID = 'conges-certideal';
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Vérifie le jeton → { uid, email } | null.
export async function getVerifiedUser(req, verifyOverride) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '');
  if (!m) return null;
  try {
    if (verifyOverride) return await verifyOverride(m[1]);
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    if (!payload.sub) return null;
    return { uid: payload.sub, email: (payload.email || '').toLowerCase() };
  } catch {
    return null;
  }
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
