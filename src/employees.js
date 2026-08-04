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

// Rétrocompat (ancien code)
export const ADMIN_NAME = "Laure COHEN"
