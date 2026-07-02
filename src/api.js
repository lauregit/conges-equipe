// Client for the Neon-backed serverless API (/api/leaves, /api/employees).

const LEAVES = '/api/leaves';
const EMPLOYEES = '/api/employees';

// Extract the server's French error message from a failed response, falling
// back to a generic network message.
async function readError(res, fallback) {
  try {
    const body = await res.json();
    if (body && body.error) return new Error(body.error);
  } catch {
    // response had no JSON body
  }
  return new Error(fallback);
}

export async function fetchLeaves() {
  const res = await fetch(LEAVES);
  if (!res.ok) throw await readError(res, 'Impossible de charger les congés');
  return res.json();
}

export async function addLeave(leave) {
  const res = await fetch(LEAVES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leave),
  });
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer le congé");
  return res.json();
}

export async function decideLeave(id, user, action) {
  const res = await fetch(`${LEAVES}?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, action }),
  });
  if (!res.ok) throw await readError(res, 'Impossible de traiter la demande');
  return res.json();
}

export async function deleteLeave(id, user) {
  const res = await fetch(
    `${LEAVES}?id=${encodeURIComponent(id)}&user=${encodeURIComponent(user)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw await readError(res, 'Impossible de supprimer le congé');
  return res.json();
}

export async function fetchEmployees() {
  const res = await fetch(EMPLOYEES);
  if (!res.ok) throw await readError(res, "Impossible de charger l'équipe");
  return res.json();
}

export async function saveEmployee(actor, employee) {
  const res = await fetch(EMPLOYEES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, employee }),
  });
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer la personne");
  return res.json();
}
