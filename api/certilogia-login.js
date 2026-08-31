import { signSession } from './_session.js';

// SSO Certilogia -> session maison (Neon). Le serveur revalide lui-même les
// identifiants auprès de certilogia-admin (ne fait jamais confiance à un
// "succès" côté client), puis signe un jeton de session propre à l'app.
// Pas de compte miroir, pas de second mot de passe à désynchroniser — un
// changement de mot de passe Certilogia n'a plus aucun effet sur la session.

const CERTILOGIA_ADMIN = 'https://certilogia-admin.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) {
      res.status(400).json({ error: 'email et password requis' });
      return;
    }

    let certRes;
    try {
      certRes = await fetch(`${CERTILOGIA_ADMIN}/api/auth-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      res.status(502).json({ error: 'Certilogia injoignable — réessayez.' });
      return;
    }
    if (certRes.status === 401) {
      res.status(401).json({ error: 'Identifiants Certilogia incorrects' });
      return;
    }
    if (certRes.status === 403) {
      res.status(403).json({ error: 'Compte Certilogia désactivé' });
      return;
    }
    if (!certRes.ok) {
      res.status(502).json({ error: 'Erreur Certilogia — réessayez.' });
      return;
    }
    const { session } = await certRes.json();

    const token = await signSession({ email: session.user.email, name: session.user.name });
    res.status(200).json({ ok: true, token, email: session.user.email });
  } catch (err) {
    console.error('certilogia-login error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
