# 🏖️ Congés Équipe — CertiDeal

Demandes de congé, validation par les managers, et vue de présence par équipe.

## Comment ça marche

- **Personnel & organigramme** : [RH Compliance](https://rh-compliance.vercel.app)
  est la source unique — la fonction serverless `api/roster.js` lit les
  salariés (CDI + alternants) et leurs pôles/managers depuis sa base
  (`RH_POSTGRES_URL`). Seuls des champs annuaire sont exposés (nom, email,
  pôle, poste, drapeau manager) — jamais de données RH sensibles.
- **Congés** : Neon Postgres (table `conges_leaves`). Connexion SSO
  Certilogia uniquement — identifiants revalidés côté serveur à chaque
  connexion contre `certilogia-admin`, session maison signée (voir
  `api/_session.js` ; plus de mot de passe Firebase à maintenir en double).
- **Workflow** (`src/leavePolicy.js`, testé) :
  - demande de congé → `pending`, à valider par le **superviseur RH désigné**
    (organigramme partagé `rh_org`), à défaut les **managers du pôle** +
    **approbateurs délégués** (`EXTRA_APPROVERS` dans `src/employees.js`),
    toujours secondé par les **admins globaux**
  - un responsable d'équipe demandant pour lui-même : validable uniquement
    par la direction (admins globaux) — jamais par un pair
  - arrêt maladie / congé sans solde : SAISIE réservée aux managers (pour
    leur équipe) et à `RESTRICTED_TYPE_HR_EMAILS` (`src/employees.js`,
    pour tout le monde) — jamais en libre-service par le salarié
  - saisie par un approbateur (ou la RH ci-dessus) pour quelqu'un → validée d'office
  - personne ne valide sa propre demande
  - décisions concurrentes protégées (transaction SQL)
  - demande en attente depuis plus de 48h → relance email automatique
    (`api/cron-reminders.js`, cron Vercel — voir `vercel.json`)
- **Emails** (SendGrid, `api/_notify.js`) : demande à valider, décision,
  déclaration/enregistrement direct, relance 48h — la direction
  (`BOOTSTRAP_ADMIN_EMAILS`, `api/_config.js`) est systématiquement informée
  de tout congé validé, quel que soit le type ou qui l'a saisi.
- **Vues** : Calendrier (son périmètre, filtrable par équipe), Présence (qui
  est là par équipe), Approbations (managers/admins, avec compteur), Équipes
  (lecture seule, reflet de l'organigramme).
- **Export paie** (`api/payroll-export.js`, admins globaux) : CSV par
  salarié — jours de congé payé / sans solde / arrêt maladie approuvés sur
  une période donnée. Bouton dans l'onglet Admin.

## Configuration

| Quoi | Où |
|---|---|
| Ajouter/retirer une personne, changer de pôle, marquer manager | RH Compliance |
| Approbateurs supplémentaires, admins globaux | `src/employees.js` (seed) / onglet Admin (config vivante) |
| RH habilitée congé sans solde / arrêt maladie pour tous | `RESTRICTED_TYPE_HR_EMAILS`, `src/employees.js` |
| Types de congés | `src/constants.js` |

Variables d'environnement (Vercel) :
- `DATABASE_URL` — Neon (congés, profils, config)
- `RH_POSTGRES_URL` — base RH Compliance partagée (personnel, organigramme)
- `CONGES_JWT_SECRET` — signature des sessions maison
- `SENDGRID_API_KEY` — envoi des emails (sans elle, l'app fonctionne mais
  n'envoie rien — best-effort, ne bloque jamais une requête)
- `CRON_SECRET` — protège `api/cron-reminders.js` (relance 48h) contre un
  déclenchement public ; voir `MIGRATIONS.md` pour la fréquence selon le
  plan Vercel (Hobby : 1×/jour max)

## Dev & tests

```bash
npm install
npm test          # Vitest — policy d'approbation, helpers de dates, emails
npm run dev       # + `vercel dev` pour /api/roster
```

> Machines avec conflit de flags CA Node : `env -u NODE_USE_SYSTEM_CA npm test`.

## Déploiement

`git push` sur `main` → Vercel déploie (front Vite + `api/*.js`).
