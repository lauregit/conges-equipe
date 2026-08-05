import postgres from 'postgres';

// Chargement serveur du personnel + organigramme depuis la base RH Compliance.
// Partagé par /api/roster (endpoint public) et /api/leaves (validation des
// écritures côté serveur). Champs annuaire uniquement — jamais de données
// RH sensibles.

let _sql;
function getRhSql() {
  const url = process.env.RH_POSTGRES_URL;
  if (!url) throw new Error('RH_POSTGRES_URL not configured');
  if (!_sql) {
    _sql = postgres(url, { ssl: { rejectUnauthorized: false }, max: 1, idle_timeout: 20 });
  }
  return _sql;
}

// Rattache les équipes "atelier" (souvent des intérimaires, sans pôle saisi)
// au pôle de l'organigramme correspondant.
const TEAM_TO_POLE = {
  'Expé': 'Logistique',
  'Expédition': 'Logistique',
  'Reconditionnement': 'Logistique',
  'Retour': 'Logistique',
  'Test': 'Logistique',
  'Init': 'Logistique',
  'Market': 'Marketing',
};

function groupOf(e) {
  const pole = String(e.pole || '').trim();
  if (pole) return pole;
  const team = String(e.team || '').trim();
  return TEAM_TO_POLE[team] || team || 'Autre';
}

// La Logistique se décompose en pôles opérationnels : Expédition, Test,
// Réparation, Pickup, Retour, RMA/Réception. Déduits du "team réel" et du
// "poste réel" RH ; les non-classés restent en « Logistique » tout court
// (reste à ranger — corriger côté RH Compliance ou via le pôle d'affichage).
function logistiqueSubPole(e) {
  const team = String(e.team || '').toUpperCase();
  const poste = String(e.poste_reel || '').toUpperCase();
  const both = `${team} ${poste}`;
  if (/RMA|RECEPTION|RÉCEPTION|INIT/.test(both)) return 'RMA / Réception';
  if (/RETOUR|REVERSE/.test(both)) return 'Retour';
  if (/PICK/.test(both)) return 'Pickup';
  if (/REPARA|RÉPARA/.test(both)) return 'Réparation';
  if (/TEST/.test(both)) return 'Test';
  if (/EXPE|EXPÉ|LIVRAISON|ECRASEMENT|COMMANDE/.test(both)) return 'Expédition';
  return null;
}

function displayTeam(e) {
  const group = groupOf(e);
  if (group !== 'Logistique') return group;
  const sub = logistiqueSubPole(e);
  return sub ? `Logistique — ${sub}` : 'Logistique';
}

// Détection "manager" depuis l'organigramme RH (voir api/roster.js pour la
// justification des motifs — attention aux faux positifs type
// "assistant/junior/key account manager").
function isOrgManager(e) {
  const posteReel = String(e.poste_reel || '').toUpperCase();
  const position = String(e.position || '').toUpperCase();
  if (/(^|\s)(MANAGER|RESPONSABLE)(\s|$|\/)/.test(posteReel)) return true;
  if (/^(HEAD OF|CTO$|CEO$|DG$|DIRECTEUR|DIRECTRICE|RESPONSABLE|MANAGER )/.test(position)) return true;
  if (Number(e.ranking) >= 5) return true;
  return false;
}

// Salariés (CDI + alternants) actifs, format roster de l'app — ENRICHIS de
// l'organigramme partagé `rh_org` (même base que rh_entities, éditable depuis
// RH Compliance ET depuis l'Admin de cette app) :
//   supervisor    = N+1 (le N+2 s'obtient en remontant la chaîne)
//   rhSupervisor  = validateur congés désigné
//   replacements  = qui peut remplacer cette personne (règle anti-chevauchement)
export async function loadRoster(sqlOverride) {
  const sql = sqlOverride || getRhSql();
  const [rows, orgRows] = await Promise.all([
    sql`SELECT data FROM rh_entities WHERE kind = 'employee'`,
    sql`SELECT employee_id, supervisor_id, rh_supervisor_id, replacement_ids, team_override FROM rh_org`
      // 42P01 = table pas encore créée : roster sans organigramme. Toute
      // autre erreur remonte (ne pas dégrader silencieusement les approbations).
      .catch(err => { if (err?.code === '42P01') return []; throw err; }),
  ]);
  const all = rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  // Résolution id → nom sur TOUT le personnel (un lien vers une personne
  // devenue inactive doit encore s'afficher, pas devenir null en silence).
  const nameById = new Map(
    all.filter(e => e && e.first_name && e.last_name)
       .map(e => [Number(e.id), `${String(e.first_name).trim()} ${String(e.last_name).trim()}`])
  );
  const orgById = new Map(orgRows.map(o => [Number(o.employee_id), o]));
  const nameOf = id => (id == null ? null : nameById.get(Number(id)) || null);
  return all
    .filter(e => e && e.active !== false && e.first_name && e.last_name &&
      (e.type === 'cdi' || e.type === 'alternant'))
    .map(e => {
      const o = orgById.get(Number(e.id));
      const reps = Array.isArray(o?.replacement_ids) ? o.replacement_ids
        : (typeof o?.replacement_ids === 'string' ? JSON.parse(o.replacement_ids) : []);
      return {
        id: e.id,
        name: `${String(e.first_name).trim()} ${String(e.last_name).trim()}`,
        email: e.email || null,
        team: o?.team_override || displayTeam(e),
        teamOverride: o?.team_override || null,
        position: e.position || e.poste_reel || null,
        manager: isOrgManager(e),
        type: e.type || null,
        supervisor: nameOf(o?.supervisor_id),
        rhSupervisor: nameOf(o?.rh_supervisor_id),
        replacements: (reps || []).map(nameOf).filter(Boolean),
      };
    })
    .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}

// Écrit la chaîne de commandement dans la table partagée rh_org.
// replacement_ids est volontairement PRÉSERVÉ (mis à jour séparément).
export async function saveOrgHierarchy(employeeId, supervisorId, rhSupervisorId, updatedBy, sqlOverride) {
  const sql = sqlOverride || getRhSql();
  await sql`INSERT INTO rh_org (employee_id, supervisor_id, rh_supervisor_id, updated_at, updated_by)
            VALUES (${Number(employeeId)}, ${supervisorId == null ? null : Number(supervisorId)},
                    ${rhSupervisorId == null ? null : Number(rhSupervisorId)}, now(), ${updatedBy})
            ON CONFLICT (employee_id) DO UPDATE SET
              supervisor_id    = EXCLUDED.supervisor_id,
              rh_supervisor_id = EXCLUDED.rh_supervisor_id,
              updated_at       = now(),
              updated_by       = EXCLUDED.updated_by`;
}

// Écrit le pôle d'affichage (ex. « SAV — France ») dans rh_org — le reste
// de la ligne est préservé. null = retour au pôle automatique.
export async function saveOrgTeamOverride(employeeId, teamOverride, updatedBy, sqlOverride) {
  const sql = sqlOverride || getRhSql();
  await sql`INSERT INTO rh_org (employee_id, team_override, updated_at, updated_by)
            VALUES (${Number(employeeId)}, ${teamOverride}, now(), ${updatedBy})
            ON CONFLICT (employee_id) DO UPDATE SET
              team_override = EXCLUDED.team_override,
              updated_at    = now(),
              updated_by    = EXCLUDED.updated_by`;
}

// Écrit les remplaçants dans rh_org (supervisor/rh_supervisor préservés).
export async function saveOrgReplacements(employeeId, replacementIds, updatedBy, sqlOverride) {
  const sql = sqlOverride || getRhSql();
  const ids = [...new Set((replacementIds || []).map(Number))].filter(x => x !== Number(employeeId));
  await sql`INSERT INTO rh_org (employee_id, replacement_ids, updated_at, updated_by)
            VALUES (${Number(employeeId)}, ${JSON.stringify(ids)}::jsonb, now(), ${updatedBy})
            ON CONFLICT (employee_id) DO UPDATE SET
              replacement_ids = EXCLUDED.replacement_ids,
              updated_at      = now(),
              updated_by      = EXCLUDED.updated_by`;
}
