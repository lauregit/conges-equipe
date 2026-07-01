// Client for the leave API (Neon-backed serverless function at /api/leaves).
// Replaces the previous Firebase Firestore access.

const BASE = '/api/leaves';

export async function fetchLeaves() {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error('Failed to load leaves');
  return res.json();
}

export async function addLeave(leave) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leave),
  });
  if (!res.ok) throw new Error('Failed to add leave');
  return res.json();
}

export async function deleteLeave(id) {
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete leave');
  return res.json();
}
