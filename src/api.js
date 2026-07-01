// Client for the leave API (Neon-backed serverless function at /api/leaves).
// Replaces the previous Firebase Firestore access.

const BASE = '/api/leaves';

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
  const res = await fetch(BASE);
  if (!res.ok) throw await readError(res, 'Impossible de charger les congés');
  return res.json();
}

export async function addLeave(leave) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leave),
  });
  if (!res.ok) throw await readError(res, "Impossible d'enregistrer le congé");
  return res.json();
}

export async function deleteLeave(id, user) {
  const res = await fetch(
    `${BASE}?id=${encodeURIComponent(id)}&user=${encodeURIComponent(user)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw await readError(res, 'Impossible de supprimer le congé');
  return res.json();
}
