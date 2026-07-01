# 🏖️ Calendrier Congés — Équipe Marketing Certideal

Application web de gestion des congés d'équipe, partagée en ligne.

## Fonctionnalités

- Connexion par nom (liste des collaborateurs)
- Pose de congés (CP, RTT, maladie, autre)
- Calendrier mensuel partagé (rechargé à la connexion et au retour sur l'onglet)
- Vue admin pour Laure COHEN (suppression de tous les congés)
- Chaque collaborateur peut voir et supprimer ses propres congés

## Stack

- React + Vite
- Neon (Postgres serverless) via `@neondatabase/serverless`
- Fonctions serverless Vercel sous `/api`
- date-fns (manipulation des dates)

## Base de données

Une seule table Postgres :

```sql
CREATE TABLE IF NOT EXISTS conges_leaves (
  id         BIGSERIAL PRIMARY KEY,
  employee   TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  type       TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

L'API (`api/leaves.js`) lit la connexion depuis la variable d'environnement
`DATABASE_URL`.

## Installation & lancement (local)

```bash
npm install

# Terminal 1 — sert les fonctions /api sur :3000 (nécessite `vercel login`)
vercel dev

# Terminal 2 — sert le front (proxy /api -> :3000)
npm run dev
```

> `DATABASE_URL` doit être disponible pour `vercel dev` (via `vercel env pull`
> ou un fichier `.env` local non commité).

## Déploiement (Vercel)

1. Importer ce repo dans le projet Vercel du compte Certideal.
2. Ajouter la variable d'environnement **`DATABASE_URL`** (chaîne de connexion Neon)
   dans *Project Settings → Environment Variables*.
3. Vercel détecte Vite automatiquement (build `dist/`) et déploie `api/*.js`
   comme fonctions serverless. `git push` = déploiement.
