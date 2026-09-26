# AGENTS.md — Congés Équipe (Certideal)

Guide d'orientation pour un agent de code (Codex, Claude, etc.) qui intervient
sur ce repo. Lis ce fichier en premier — il décrit l'architecture réelle,
pas une intention de départ : le projet a beaucoup bougé (migration Firebase →
Neon, puis SSO Certilogia, puis organigramme partagé avec RH Compliance).

## En une phrase

App de congés d'équipe (React + Vite, SPA) : demande → validée par un
responsable désigné (organigramme partagé avec RH Compliance) → visible en
calendrier/présence. Auth = SSO Certilogia uniquement. Deux bases Postgres :
Neon (congés/comptes de cette app) et Supabase RH Compliance (personnel +
organigramme, **partagée en écriture** avec un autre repo).

## Qui possède quoi (important avant de toucher au repo)

- **Repo GitHub** : `lauregit/conges-equipe` — propriété de **Laure**, pas de
  Yoann. Yoann (`yovalensi`) est contributeur avec accès push.
- **Laure travaille depuis une session cloud sans accès en écriture au repo.**
  Son historique de commits ne montre donc jamais son nom : ses patches sont
  transmis et appliqués (`git am` + PR) par quelqu'un qui a les droits. Si un
  patch dit "produit par la session Claude de Laure", c'est normal — ne pas
  le prendre pour une usurpation, mais bien vérifier son contenu (voir PR #17
  : un email codé en dur ne correspondait pas au vrai compte Certilogia).
- **Déploiement = `git push` sur `main`.** Vercel auto-déploie ce repo à
  chaque push (contrairement à `certilogia-admin`, un repo voisin qui se
  déploie par `vercel --prod` direct, sans lien Git — ne pas confondre les
  deux workflows si tu interviens sur les deux projets).
- Aucune protection de branche sur `main` : un `git push` direct passe. Le
  workflow observé dans l'historique est quand même systématiquement
  branche → PR → squash-merge, y compris pour de petits fixes — à reproduire.

## Architecture

```
Frontend  React 19 + Vite, SPA pure (pas de SSR)      src/
Backend   Fonctions serverless Vercel (Node ESM)      api/
DB congés Neon Postgres (DATABASE_URL)                 conges_leaves, conges_profiles, conges_settings
DB RH     Supabase Postgres (RH_POSTGRES_URL)           rh_entities (lecture seule ici), rh_org (LECTURE+ÉCRITURE, partagée)
Email     SendGrid (SENDGRID_API_KEY) — best-effort, ne bloque jamais une requête
Cron      Vercel Cron (vercel.json) — relance 48h
```

Pas de build "au build" pour l'API : chaque fichier `api/*.js` est une
fonction serverless indépendante (export default handler(req, res, overrides)).
Le paramètre `overrides` (sql/roster/config/verify/sendEmail…) n'existe QUE
pour l'injection de dépendances en test — jamais utilisé en prod.

## Les deux bases Postgres — ne pas les confondre

1. **Neon (`DATABASE_URL`)** — propriété exclusive de cette app :
   - `conges_leaves` : chaque congé (employee, dates, type, note, status,
     submitted_by, decided_by, decided_at, reminded_at).
   - `conges_profiles` : lie un compte connecté (`uid` = email Certilogia en
     minuscules) à un nom du personnel RH. `status` = `approved` | `pending`.
   - `conges_settings` : une ligne clé `config` = `{globalAdmins, extraApprovers}`
     (JSON), éditable depuis l'onglet Admin, seedée depuis `src/employees.js`
     au premier chargement.

2. **Supabase RH Compliance (`RH_POSTGRES_URL`)** — **PAS à cette app** :
   - `rh_entities` (kind='employee') : fiche RH de chaque salarié. Cette app
     ne lit QUE des champs annuaire (nom, email, pôle, poste, type de
     contrat) — jamais rien de sensible (salaire, période d'essai, etc.).
     Seuls les CDI et alternants actifs sont retenus (les intérimaires sont
     gérés par leur agence, pas dans ce workflow).
   - `rh_org` : organigramme **PARTAGÉ EN ÉCRITURE** avec le repo
     `rh-compliance` (page "Organigramme & Remplaçants" là-bas). Colonnes :
     `employee_id`, `supervisor_id` (N+1), `rh_supervisor_id` (validateur
     congés désigné), `replacement_ids` (jsonb, binômes), `team_override`
     (texte libre, ex. "SAV — France"). **Modifier cette table depuis
     `conges-equipe` change aussi ce que voit RH Compliance, et inversement.**
     Ne jamais supprimer/renommer une colonne sans vérifier l'autre repo.

`api/_rhroster.js` fusionne les deux en un seul objet roster
`{ name, email, team, position, manager, type, supervisor, rhSupervisor,
replacements, teamOverride }` — c'est la forme que consomment `leavePolicy.js`
et tous les composants React. Si tu ajoutes un champ RH, ajoute-le ici.

## Auth — SSO Certilogia, sessions maison (PAS Firebase)

Firebase a été **entièrement retiré** (dépendance désinstallée, ~800 Ko de
bundle en moins). Ne jamais réintroduire `firebase`/`firebase-admin` : la
raison du retrait était un bug réel — un compte Firebase "miroir" restait
sur l'ancien mot de passe après un changement côté Certilogia, sans recours
possible sans clé Admin SDK. Voir `git log` pour "connexion Certilogia
cassée" si le sujet revient.

Flux actuel :
1. `api/certilogia-login.js` reçoit `{email, password}`, **revalide lui-même**
   ces identifiants auprès de `https://certilogia-admin.vercel.app/api/auth-login`
   (jamais de confiance dans un succès côté client).
2. En cas de succès, signe un JWT maison (`api/_session.js`, `jose`/HS256,
   secret `CONGES_JWT_SECRET`) — `sub` = email en minuscules, expire 30j.
3. Le client stocke ce jeton (`localStorage`, clé `conges_session_token`,
   voir `src/api.js`) et l'envoie en `Authorization: Bearer` sur CHAQUE appel.
4. `api/_auth.js` : `requireToken` vérifie le jeton ; `requireProfile` va plus
   loin et exige un profil `conges_profiles` avec `status='approved'`.

**Anti-usurpation à la première connexion** (`api/profile.js`) : quand on
choisit son nom dans la liste RH, la liaison est auto-approuvée seulement si
l'email de connexion == l'email RH de cette personne (ou si le compte est
dans `BOOTSTRAP_ADMIN_EMAILS`, `api/_config.js` — sert à amorcer le tout
premier admin). Sinon la liaison reste `pending` jusqu'à validation manuelle
dans l'onglet Admin. Un nom = un seul compte.

## Le moteur de règles : `src/leavePolicy.js`

Fonctions pures, testées, PARTAGÉES par le front (prévisualisation dans
`LeaveForm`) et le back (application réelle dans `api/leaves.js`) — ne
jamais dupliquer une règle, importer depuis ce fichier des deux côtés.

- **`chainOf(name, roster)`** : remonte les N+1 jusqu'à 5 niveaux
  (`MAX_CHAIN`), protégé contre les cycles.
- **`canSee(viewer, employee, ...)`** : visibilité — soi-même, admin global,
  n'importe qui dans SA chaîne descendante (son sous-arbre), OU son
  approbateur désigné même hors chaîne (sinon un validateur ne verrait pas
  ce qu'il doit décider — bug corrigé en PR #9, voir le test dédié).
- **`approversOf` vs `approversForNotification`** : ATTENTION à la nuance.
  `approversOf`/`canDecide` = qui a **le droit** de décider (inclut toujours
  les admins globaux, pour la sécurité). `approversForNotification` = qui
  **notifier** d'une demande — n'inclut les admins que quand ils sont les
  SEULS décideurs possibles (sinon la direction recevrait un email pour
  chaque demande de toute l'entreprise). Utilisé par `api/_recipients.js`
  pour construire la liste des destinataires email.
- **`initialStatus`** : statut à la création — `approved` d'office si type
  déclaré (arrêt maladie), si saisi PAR un approbateur pour quelqu'un
  d'autre, ou si un admin global se le saisit à lui-même (personne au-dessus
  pour valider). Sinon `pending` s'il existe au moins un approbateur, sinon
  `approved` par défaut historique (équipe sans validateur configuré).
- **`isSpecialRequest`** (> `MAX_STANDARD_LEAVE_DAYS` = 14 jours, hors type
  déclaré) : validable UNIQUEMENT par un admin global, jamais par le
  superviseur RH habituel — `canDecideLeave` applique cette bascule.
- **Remplaçants** (`replacementPartners`, `replacementConflicts`) : lien
  bidirectionnel (A remplace B ⟺ B remplace A) stocké dans `rh_org` ; deux
  binômes ne peuvent pas être ABSENTS (pas télétravail) en même temps —
  bloqué en 409 sauf pour un admin global qui peut forcer.

## Types de congé et restrictions de saisie (`src/constants.js` + `src/employees.js`)

`LEAVE_TYPES` : `conge_paye`, `conge_sans_solde`, `teletravail`,
`arret_maladie`. `RESTRICTED_SUBMIT_TYPES` (`conge_sans_solde`,
`arret_maladie`) ne peuvent JAMAIS être saisis en libre-service par le
salarié pour lui-même — seulement par : son responsable (via `canDecide`,
qui saisit alors POUR lui), un admin global, ou une personne listée dans
`RESTRICTED_TYPE_HR_EMAILS` (RH habilitée pour tout le monde, identifiée par
**email de connexion Certilogia**, pas par nom — vérifier ces emails contre
les vrais comptes avant de les modifier, voir la note ci-dessous).

⚠️ **Piège vécu** : `RESTRICTED_TYPE_HR_EMAILS` avait un email inventé
(`manel@certideal.com` au lieu du vrai `manel.rebhi@certideal.com`) qui
faisait échouer silencieusement la fonctionnalité pour cette personne (pas
d'erreur visible, juste "ça ne marche pas pour elle"). Si tu ajoutes/modifies
un email dans ce fichier, vérifie-le contre le compte réel côté
`certilogia-admin` (table Redis `certilogia:auth:*`) plutôt que de le
supposer depuis un nom.

## Notifications email (`api/_notify.js` + `api/_recipients.js`)

Best-effort partout : un envoi qui échoue est loggé (`console.error`) mais ne
fait JAMAIS échouer la requête HTTP (le congé est déjà enregistré). Sender
SendGrid pinné (voir mémoire `sendgrid_sender.md` — seul `yvalensi@gmail.com`
est vérifié, `@certideal.com` bounce en 403 tant que le domaine n'est pas
authentifié).

- Demande créée `pending` → email "à valider" aux VRAIS décideurs
  (`decisionRecipients`, avec repli garanti sur `BOOTSTRAP_ADMIN_EMAILS` s'ils
  sont les seuls décideurs).
- Demande validée d'office (déclarée, ou saisie par un manager/la RH pour
  autrui) → email d'info aux responsables concernés + **toujours** à la
  direction (`BOOTSTRAP_ADMIN_EMAILS`) — visibilité systématique demandée par
  Laure sur tout congé validé, quel que soit le type ou qui l'a saisi.
- Décision prise → email au demandeur ; si approuvée, FYI direction en plus.
- Relance 48h (cron) → mêmes destinataires que l'email initial.

## Cron : relance à 48h (`api/cron-reminders.js`)

Une demande `pending` depuis plus de 48h et jamais relancée
(`reminded_at IS NULL`) reçoit un rappel, puis `reminded_at` est posé (une
seule relance par demande, jamais plus). Déclenché par Vercel Cron
(`vercel.json`, `"0 */6 * * *"`), protégé par `CRON_SECRET` (Vercel envoie
`Authorization: Bearer $CRON_SECRET` automatiquement — si la variable
n'existe pas, l'endpoint reste ouvert, donc **ne jamais déployer sans
`CRON_SECRET` configuré**). Note historique dans `MIGRATIONS.md` : sur un
plan Vercel Hobby, le cron est limité à 1×/jour — la fréquence 6h suppose un
plan payant (déjà le cas ici, confirmé par le déploiement réussi).

## Export paie (`api/payroll-export.js` + `src/payroll.js`)

CSV des jours de congé payé/sans solde/arrêt maladie approuvés sur une
période, par salarié — réservé aux admins globaux, bouton dans l'onglet
Admin. Agrégation dans `src/payroll.js` (fonctions pures, testées
séparément dans `tests/payroll.test.js`).

## Délégation d'administration (`api/admin.js` + `src/components/AdminPanel.jsx`)

Deux niveaux :
- **Admins globaux** (Laure, Yoann + `BOOTSTRAP_ADMIN_EMAILS`) : tout —
  comptes en attente, config (`globalAdmins`/`extraApprovers`), organigramme
  entier.
- **Managers/approbateurs** (n'importe qui avec `isApprover(...) === true`) :
  onglet "🛠️ Mon équipe", même UI mais périmètre restreint côté SERVEUR
  (`canManage`, dans `api/admin.js`) à leur sous-arbre + personnes qu'ils
  valident — jamais eux-mêmes, jamais les comptes/la config globale. Ne pas
  se fier au frontend pour cette restriction : elle est vérifiée à chaque
  action POST côté API, c'est la garantie réelle.

## Frontend — carte des composants (`src/`)

- `App.jsx` — orchestrateur : calcule tous les rôles/périmètres dérivés
  (`amGlobalAdmin`, `canApprove`, `amRestrictedHR`, `visibleEmployees`,
  `decidable`…) à partir de `leavePolicy.js`, distribue aux vues par onglet.
- `AuthScreen.jsx` — connexion Certilogia + sélecteur de nom (première
  connexion).
- `Calendar.jsx` / `Presence.jsx` — vues congés par personne / par équipe.
- `Approvals.jsx` — file d'attente de décision + historique du sous-arbre.
- `LeaveForm.jsx` — saisie, reproduit `initialStatus`/`isSpecialRequest`/
  `replacementConflicts` côté client pour prévisualiser AVANT l'envoi (le
  serveur retranche toujours la vérité).
- `TeamSettings.jsx` — vue en lecture seule de l'organigramme (tout le
  monde).
- `AdminPanel.jsx` — administration (voir section précédente).
- `leavePolicy.js`, `constants.js`, `employees.js`, `utils/names.js` —
  copies FRONT des mêmes règles/constantes que l'API (le code est dupliqué
  entre `src/` et importé tel quel par `api/*.js` via des chemins relatifs
  `../src/...` — un seul fichier source, pas une vraie duplication).

## Tests

```bash
npm test                              # vitest run — 8 fichiers, 105 tests
env -u NODE_USE_SYSTEM_CA npm test     # si conflit de flags CA Node (voir mémoire)
npm run lint                           # oxlint
npm run build                          # vite build — doit rester propre
```

Convention des tests API (`tests/*Api.test.js`) : pas de vraie base — un
faux `sql(query, params)` qui route par **regex sur le texte de la requête**
(`makeDb`/`makeSql` dans chaque fichier). En ajoutant une requête SQL dans un
handler, vérifie que son texte matche (ou ajoute) le bon pattern regex dans
le mock du test correspondant, sinon le test passe silencieusement sur une
route par défaut (`return []`) qui peut masquer un vrai bug.

## Variables d'environnement (Vercel, projet `conges-equipe`)

| Variable | Rôle | Si absente |
|---|---|---|
| `DATABASE_URL` | Neon (congés/comptes/config) | 500 partout |
| `RH_POSTGRES_URL` | Supabase RH Compliance (personnel/organigramme) | 500 partout |
| `CONGES_JWT_SECRET` | Signature des sessions | 500 à la connexion |
| `SENDGRID_API_KEY` | Envoi des emails | Best-effort silencieux, aucune erreur visible |
| `CRON_SECRET` | Protège `/api/cron-reminders` | Endpoint public sans elle — à toujours configurer |

## Avant de committer

1. `npm test` + `npm run lint` + `npm run build` — toujours les trois.
2. Si tu touches à une nouvelle colonne/table Neon : vérifier/mettre à jour
   `MIGRATIONS.md` (déjà en retard sur plusieurs PR — ne pas aggraver).
3. Si tu touches à `rh_org` : le changement est visible dans
   `rh-compliance` aussi — ne pas supposer que ce repo est le seul
   consommateur.
4. Branche → PR → squash-merge sur `main` (jamais de push direct constaté
   dans l'historique, même pour un fix d'une ligne).
5. `git push` sur `main` = déploiement automatique Vercel — vérifier après
   coup que `https://conges-equipe-beryl.vercel.app` répond (`/` = 200,
   `/api/leaves` sans jeton = 401 attendu).
