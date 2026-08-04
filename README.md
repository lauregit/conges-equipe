# 🏖️ Congés Équipe — CertiDeal

Demandes de congé, validation par les managers, et vue de présence par équipe.

## Comment ça marche

- **Personnel & organigramme** : [RH Compliance](https://rh-compliance.vercel.app)
  est la source unique — la fonction serverless `api/roster.js` lit les
  salariés (CDI + alternants) et leurs pôles/managers depuis sa base
  (`RH_POSTGRES_URL`). Seuls des champs annuaire sont exposés (nom, email,
  pôle, poste, drapeau manager) — jamais de données RH sensibles.
- **Congés** : Firebase Firestore (collection `leaves`), auth Firebase
  (email + mot de passe, profil lié à un nom du personnel).
- **Workflow** (`src/leavePolicy.js`, testé) :
  - demande de congé → `pending`, à valider par un **manager du pôle**
    (organigramme), un **approbateur délégué** (`EXTRA_APPROVERS` dans
    `src/employees.js`) ou un **admin global**
  - arrêt maladie → déclaré immédiatement
  - saisie par un approbateur pour quelqu'un → validée d'office
  - personne ne valide sa propre demande
  - décisions concurrentes protégées (transaction Firestore)
- **Vues** : Calendrier (son périmètre), Présence (qui est là par équipe),
  Approbations (managers/admins, avec compteur), Équipes (lecture seule,
  reflet de l'organigramme).

## Configuration

| Quoi | Où |
|---|---|
| Ajouter/retirer une personne, changer de pôle, marquer manager | RH Compliance |
| Approbateurs supplémentaires, admins globaux | `src/employees.js` |
| Types de congés | `src/constants.js` |

Variables d'environnement (Vercel) : `RH_POSTGRES_URL` (base RH).

## Dev & tests

```bash
npm install
npm test          # Vitest — policy d'approbation, helpers de dates, emails
npm run dev       # + `vercel dev` pour /api/roster
```

> Machines avec conflit de flags CA Node : `env -u NODE_USE_SYSTEM_CA npm test`.

## Déploiement

`git push` sur `main` → Vercel déploie (front Vite + `api/*.js`).
