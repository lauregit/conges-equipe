// ── Équipes ──────────────────────────────────────────────────────────────────

export const TEAMS = {
  growth: {
    name: "Growth & Data",
    members: [
      "Laure COHEN",
      "Lucas DOSSO",
      "Salvatore MACRI",
      "Oleksandr FESENKO",
      "Maxime CAHIER",
      "Tiberius SCLIPCEA",
      "Oussama RABOUN",
      "Manel REBHI",
      "Ammar AHMED",
      "Fernando DE LA GUARDIA",
      "Elise VERSINI",
      "Rebecca FAHED",
      "Hajar FIOUZ",
      "Laura ZITH",
      "Giada SCAROLA",
      "Adrien CHABANEL",
      "Benjamin AZOR",
      "Amir Mohammad FOROOZAN",
      "Yoana GUEGUEN",
      "Marengo Digital",
      "Clementine PITHON",
      "LYPIRIDOU SOFIA",
      "DOS REIS PEREIRA AMANDA",
      "Yoann VALENSI",
    ],
    // Peuvent voir et saisir pour toute leur équipe
    superAdmins: ["Laure COHEN", "Lucas DOSSO", "Oussama RABOUN", "Yoann VALENSI"],
  },
  customer_success: {
    name: "Customer Success",
    members: [
      "Andrea LEVY",
      "Eden KTORZA",
      "Vithusa VASIDDAN",
      "Apolline SARAGONI",
      "Arthur MBAKOP-RAGUIN",
      "Alioune DIOP",
      "Melissa BOISNEAULT",
      "Gabin GEHANT",
      "Lucas MEBIAM",
      "Rayane DAGUIA",
      "Morgan MALABRE",
      "Gaia BRANCATI",
      "Oceane ROLLET",
      "Aminata BAMBA",
      "Tom HIGUINER",
      "Maeline LAPOSTE",
      "Sibilla OLLA",
      "Andy PETI MALENGI",
      "Maeva RAKOTONDRAMANANA",
      "Bhanuka RUPASINGHE",
      "Aira Maria SAMBAKON SANFUEGO",
      "Juan Diego TORRES HERRERA",
      "Louise HEYL",
      "Matteo GUERRIAU",
      "Francesca CHIERICI",
      "Judith TORRES JIMENEZ",
      "Mackenzie LUCAS",
      "Cloé PERON",
      "Farès TALBI",
      "Caroline DAL FARRA",
      "Laila DARKAOUI BENITEZ",
      "Blanka MAJCHRZAK",
      "Gislaine MILLET",
      "Florine RINGOT",
      "Noure SKOUKNI",
      "Yannis SOUARE",
      "Izza AMER",
      "Lilas BENARIES",
      "Esther DAGO",
      "Mehdi HAMITOUCHE",
      "Cédric LATCHMAN",
      "Fatoumata MBODJI",
      "Stefan VUKOJEVIC",
      "Margaux BOUDADI-SVENSSON",
      "Yoann VALENSI",
      "Laure COHEN",
    ],
    superAdmins: ["Laure COHEN", "Andrea LEVY", "Vithusa VASIDDAN", "Apolline SARAGONI", "Yoann VALENSI"],
  },
}

// Super admins globaux : voient TOUTES les équipes
export const GLOBAL_SUPER_ADMINS = ["Laure COHEN", "Yoann VALENSI"]

// Tout le monde (toutes équipes confondues, dédupliqué)
export const ALL_EMPLOYEES = [
  ...new Set([
    ...TEAMS.growth.members,
    ...TEAMS.customer_success.members,
  ])
]

// Retourne l'équipe d'un employé (la première trouvée)
export function getTeamOf(name) {
  for (const [key, team] of Object.entries(TEAMS)) {
    if (team.members.includes(name)) return { key, ...team }
  }
  return null
}

// Retourne les équipes visibles pour un super admin
export function getVisibleTeams(name) {
  if (GLOBAL_SUPER_ADMINS.includes(name)) return Object.keys(TEAMS)
  return Object.entries(TEAMS)
    .filter(([, t]) => t.superAdmins.includes(name))
    .map(([key]) => key)
}

// Rétrocompat
export const ADMIN_NAME = "Laure COHEN"
export const SUPER_ADMIN_NAMES = [
  ...new Set(Object.values(TEAMS).flatMap(t => t.superAdmins))
]

