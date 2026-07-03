# 🏖️ Calendrier Congés — Équipe Marketing Certideal

Application web de gestion des congés d'équipe, partagée en ligne.

## Fonctionnalités

- Connexion par nom (roster en base, onglet **Équipe** pour l'administrer)
- Pose de congés (CP, RTT, autre) et déclaration d'absence (maladie)
- **Workflow d'approbation opt-in** : une demande passe « en attente » uniquement
  si l'équipe a un **manager** actif ; sans manager, le congé est enregistré
  directement (comportement historique). La maladie est toujours déclarée
  immédiatement.
- **Notifications email** (SendGrid) : demande → managers de l'équipe + admins ;
  décision → demandeur. Best-effort : sans email renseigné, rien ne part.
- **Vue Présence** : qui est là / absent par équipe pour une date donnée
  (chacun voit son équipe, les admins voient tout)
- Onglet **Approbations** pour managers (leur équipe) et admins (tout)
- Onglet **Équipe** (admins) : emails, équipes, rôles, ajout/désactivation
- Calendrier mensuel partagé (rechargé à la connexion et au retour sur l'onglet)
- Chaque collaborateur peut voir et supprimer ses propres congés ; les admins
  peuvent tout supprimer

## Rôles

| Rôle | Peut faire |
|------|-----------|
| `employee` | poser/supprimer ses congés, voir la présence de son équipe |
| `manager`  | + approuver/refuser les demandes de **son équipe** (jamais les siennes) |
| `admin`    | + tout approuver, gérer le roster (onglet Équipe), tout supprimer |

## Stack

- React + Vite
- Neon (Postgres serverless) via `@neondatabase/serverless`
- Fonctions serverless Vercel sous `/api` (les fichiers `_*.js` sont des
  helpers privés, les tests vivent dans `tests/` pour ne pas être déployés)
- SendGrid (expéditeur épinglé : `yvalensi@gmail.com`, seul sender vérifié)
- date-fns (manipulation des dates)

## Base de données

Deux tables Postgres — schéma complet et historique dans
[MIGRATIONS.md](MIGRATIONS.md) :

- `conges_leaves` : congés, avec `status` (`pending` | `approved` | `rejected`),
  `decided_by`, `decided_at`
- `conges_employees` : roster (`name`, `email`, `team`, `role`, `active`)

Variables d'environnement des fonctions : **`DATABASE_URL`** (Neon) et
**`SENDGRID_API_KEY`** (notifications, optionnelle — sans elle les emails
sont simplement désactivés).

## Tests

```bash
npm test          # Vitest — helpers de dates, handlers API (sql injecté), emails
```

> Sur les machines où `NODE_OPTIONS`/`NODE_USE_SYSTEM_CA` entrent en conflit :
> `env -u NODE_USE_SYSTEM_CA npm test`.

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

1. Appliquer les migrations SQL sur Neon (voir [MIGRATIONS.md](MIGRATIONS.md)).
2. Variables d'environnement : `DATABASE_URL`, `SENDGRID_API_KEY`.
3. Vercel détecte Vite automatiquement (build `dist/`) et déploie `api/*.js`
   comme fonctions serverless. `git push` = déploiement.
