// ── Configuration du workflow d'approbation ──────────────────────────────────
//
// Le PERSONNEL et l'ORGANIGRAMME viennent de RH Compliance
// (https://rh-compliance.vercel.app) via /api/roster :
//   - les équipes = pôles de l'organigramme
//   - les managers = détectés depuis l'organigramme (poste "MANAGER…",
//     "RESPONSABLE…", "HEAD OF…", CTO, direction…)
//
// Ce fichier ne contient que les AJUSTEMENTS manuels :

// Admins globaux : voient toutes les équipes, peuvent tout approuver,
// peuvent saisir pour n'importe qui.
export const GLOBAL_SUPER_ADMINS = ["Laure COHEN", "Yoann VALENSI"]

// Approbateurs SUPPLÉMENTAIRES par pôle (en plus des managers de
// l'organigramme). Utile pour déléguer sans toucher RH Compliance.
// Clé = nom du pôle tel qu'affiché dans l'app.
export const EXTRA_APPROVERS = {
  "Customer Success": ["Vithusa VASIDDAN", "Apolline SARAGONI"],
  // "Logistique": [], "Marketing": [], "Tech": [], "Data": [],
}

// RH habilitée à saisir un congé sans solde / arrêt maladie pour N'IMPORTE
// QUI (en plus des responsables d'équipe, qui peuvent le faire pour LEUR
// équipe via canDecide). Identifiée par email de connexion (comme
// BOOTSTRAP_ADMIN_EMAILS dans api/_config.js) plutôt que par nom, pour ne
// pas dépendre d'un rattachement précis dans l'organigramme RH Compliance.
export const RESTRICTED_TYPE_HR_EMAILS = ["manel.rebhi@certideal.com", "fabien.g@certideal.com"]

// Rétrocompat (ancien code)
export const ADMIN_NAME = "Laure COHEN"
