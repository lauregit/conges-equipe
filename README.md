# 🏖️ Calendrier Congés — Équipe Marketing Certideal

Application web de gestion des congés d'équipe en temps réel.

## Fonctionnalités

- Connexion par nom (liste des collaborateurs)
- Pose de congés (CP, RTT, maladie, autre)
- Calendrier mensuel partagé en temps réel (Firebase)
- Vue admin pour Laure COHEN (suppression de tous les congés)
- Chaque collaborateur peut voir et supprimer ses propres congés

## Stack

- React + Vite
- Firebase Firestore (base de données temps réel)
- date-fns (manipulation des dates)

## Setup Firebase (obligatoire)

1. Créer un projet sur [Firebase Console](https://console.firebase.google.com)
2. Activer **Firestore Database** (mode production)
3. Remplacer la config dans `src/firebase.js` avec vos clés
4. Ajouter ces règles Firestore dans la console :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /leaves/{document} {
      allow read, write: if true;
    }
  }
}
```

## Installation & lancement

```bash
npm install
npm run dev
```

## Déploiement

```bash
npm run build
# Déployer le dossier dist/ sur Firebase Hosting, Vercel, ou Netlify
```
