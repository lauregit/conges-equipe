import { SignJWT, jwtVerify } from 'jose';

// Sessions maison, signées HS256 avec un secret propre à cette app
// (CONGES_JWT_SECRET, Neon reste l'unique source de vérité pour les
// congés/profils). Remplace Firebase Auth : plus de "mot de passe miroir"
// à désynchroniser quand le mot de passe Certilogia change — c'est
// précisément ce qui cassait la connexion SSO avant ce correctif.

function getSecret() {
  const raw = process.env.CONGES_JWT_SECRET;
  if (!raw) throw new Error('CONGES_JWT_SECRET not configured');
  return new TextEncoder().encode(raw);
}

// uid = email en minuscules : stable, dérivé de l'identité Certilogia,
// aucune dépendance à un compte tiers.
export async function signSession({ email, name }) {
  const uid = email.toLowerCase();
  return new SignJWT({ email, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(uid)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

// Vérifie le jeton -> { uid, email } | null.
export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return { uid: payload.sub, email: payload.email || null };
  } catch {
    return null;
  }
}
