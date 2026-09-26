# Congés Équipe — le projet, dans son ensemble

Ce document raconte le projet pour un humain : ce que l'app fait, pourquoi
elle est construite ainsi, et comment elle a évolué. Pour un guide technique
orienté agent de code (architecture précise, pièges connus, conventions de
commit), voir [AGENTS.md](./AGENTS.md).

## 1. Ce que c'est

Une application web interne à Certideal pour gérer les congés d'équipe :

- Chaque salarié se connecte avec ses identifiants **Certilogia** (le hub
  interne de l'entreprise) et pose ses congés.
- La demande part automatiquement chez la bonne personne pour validation —
  déterminée par un **organigramme réel** (qui supervise qui), pas par une
  liste statique à maintenir à la main.
- Chacun voit un **calendrier** et une vue **présence** de son équipe ; les
  responsables voient leur périmètre, la direction voit tout.
- La paie peut exporter un CSV des jours validés par salarié et par période.

Accessible sur **https://conges-equipe-beryl.vercel.app**.

## 2. Qui possède quoi

- Le repo GitHub (`lauregit/conges-equipe`) appartient à **Laure**. **Yoann**
  est contributeur.
- Laure et Yoann sont **admins globaux** de l'app : ils voient tout, peuvent
  tout approuver, et gèrent la configuration (qui est admin, qui valide pour
  qui en secours).
- Chaque **responsable d'équipe** administre lui-même son périmètre (onglet
  "Mon équipe") : qui est son N+1, qui valide ses congés, qui le remplace.
- Le **personnel et l'organigramme** ne sont pas ressaisis ici : ils viennent
  de **RH Compliance** (https://rh-compliance.vercel.app), l'outil RH de
  l'entreprise — ajouter/retirer quelqu'un se fait là-bas, pas dans cette app.

## 3. Comment une demande de congé circule

```
Salarié pose un congé
        │
        ▼
 Type "arrêt maladie" ? ──oui──▶ déclaré immédiatement (informatif)
        │ non
        ▼
 Un responsable/RH le saisit POUR quelqu'un d'autre ? ──oui──▶ validé d'office
        │ non
        ▼
 Plus de 14 jours d'affilée ? ──oui──▶ file d'attente DIRECTION uniquement
        │ non
        ▼
 Son "superviseur RH désigné" existe-t-il ? ──oui──▶ file d'attente CE responsable
        │ non
        ▼
 File d'attente : responsable du pôle, ou repli direction
```

Deux types (**congé sans solde**, **arrêt maladie**) ne peuvent jamais être
saisis en libre-service par le salarié pour lui-même — seulement par son
responsable, la direction, ou une personne RH désignée pour toute
l'entreprise. Objectif : ces deux types passent toujours par un humain qui
confirme, jamais un clic solo.

Une fois la demande posée :
- Le(s) bon(s) destinataire(s) reçoivent un email "à valider".
- Sans décision au bout de 48h, une relance automatique part (une seule
  fois par demande).
- Dès qu'un congé est validé — peu importe comment — la direction reçoit
  systématiquement un email d'information (visibilité totale demandée par
  Laure), et le demandeur est informé de la décision.
- Deux personnes déclarées "remplaçantes" l'une de l'autre ne peuvent pas
  être absentes en même temps (sauf forçage par la direction) — pour
  toujours garder quelqu'un au poste.

## 4. Qui voit quoi

La visibilité suit l'organigramme : chacun voit ses propres congés en clair,
et ceux de toute la chaîne EN DESSOUS de lui (son équipe, et l'équipe de son
équipe, jusqu'à 5 niveaux). Hors de ce périmètre, on ne voit qu'une silhouette
anonyme dans le calendrier (une case grisée "absent", sans type ni motif) —
jamais le détail d'un congé qui ne nous regarde pas. Les admins globaux et
la RH désignée voient tout.

## 5. Histoire du projet (comment on en est arrivé là)

Le projet a connu plusieurs virages architecturaux, chacun pour une raison
concrète — utile à connaître pour comprendre pourquoi le code est comme il
est aujourd'hui plutôt que comme il aurait pu être conçu d'un seul coup :

1. **Départ** : petit calendrier de congés sur Firebase (Firestore + Auth),
   équipe unique, liste de noms codée en dur.
2. **Migration vers Neon Postgres** : Yoann a demandé que toutes les
   données vivent dans sa propre base — l'app garde son fonctionnement mais
   change de moteur de stockage.
3. **Connexion Certilogia (SSO)** : au lieu d'un compte/mot de passe propre à
   l'app, on se connecte avec ses identifiants du hub interne de
   l'entreprise — plus simple pour tout le monde, un seul mot de passe à
   retenir.
4. **Personnel branché sur RH Compliance** : la liste de noms codée en dur
   est remplacée par une lecture en direct de la vraie base RH — plus
   personne à ajouter à la main ici quand quelqu'un rejoint ou quitte
   l'entreprise.
5. **Chaîne de commandement et système d'admin** : passage d'un modèle
   "responsable de pôle" simple à un vrai organigramme (qui supervise qui,
   jusqu'à 5 niveaux), avec un superviseur RH désigné par personne, et un
   système d'admin pour le configurer sans toucher au code.
6. **Sécurisation de l'API** : chaque appel au serveur est désormais vérifié
   par un jeton signé plutôt que de faire confiance à ce que le navigateur
   affirme — corrige une vraie faille (on pouvait théoriquement se faire
   passer pour quelqu'un d'autre).
7. **Bug de connexion Certilogia** : un changement de mot de passe côté
   Certilogia cassait la connexion ici, sans recours. Cause : l'app gardait
   un compte Firebase "miroir" avec son propre mot de passe, qui restait sur
   l'ancien. Corrigé en retirant Firebase entièrement — la connexion revalide
   maintenant le mot de passe Certilogia à chaque fois, il n'y a plus de
   second mot de passe à désynchroniser.
8. **Organigramme partagé avec RH Compliance** : plutôt que de dupliquer
   "qui supervise qui" dans cette app, la donnée vit maintenant dans une
   table partagée avec RH Compliance — modifiable des deux côtés,
   synchronisée automatiquement.
9. **Workflow élargi** (le plus récent, patch de Laure) : typologie de
   congés restreinte pour les deux types sensibles, notifications email
   complètes, relance automatique à 48h, export CSV pour la paie.

## 6. Ce qu'il reste à surveiller

- **`MIGRATIONS.md` a pris du retard** — plusieurs changements de schéma
  récents n'y sont pas journalisés. À reconstituer à l'occasion.
- **La session cloud de Laure n'a pas accès en écriture au repo Git** — ses
  patches sont transmis et appliqués par quelqu'un qui a les droits. Si un
  changement semble "halluciné" ou mal attribué dans l'historique Git, c'est
  probablement ça, pas une erreur.
- **Les emails codés en dur pour la RH désignée** doivent correspondre aux
  vrais comptes de connexion Certilogia des personnes concernées — un
  mauvais email fait échouer la fonctionnalité silencieusement pour cette
  personne (déjà arrivé une fois, corrigé).
- **Certains pôles de la Logistique et le SAV** restent partiellement à
  classer (des personnes sans pôle précis, ou la répartition SAV
  France/International) — ajustable dans l'onglet Admin sans toucher au code.

## Pour aller plus loin

- Guide technique détaillé (architecture, fichiers clés, conventions) :
  [AGENTS.md](./AGENTS.md)
- Historique des migrations de base de données : [MIGRATIONS.md](./MIGRATIONS.md)
- Mise en route locale, variables d'environnement : [README.md](./README.md)
