import { neon } from '@neondatabase/serverless';

// Serverless function backing the leave calendar.
// Neon (Postgres) replaces the previous Firebase Firestore `leaves` collection.
// Routes (all on /api/leaves):
//   GET                 -> list every leave, ordered by start date
//   POST  {employee,startDate,endDate,type,note}  -> insert one
//   DELETE ?id=<id>     -> delete one by id
//
// start/end dates are stored as DATE and returned as 'yyyy-MM-dd' strings so the
// frontend's string comparisons (d >= l.startDate) keep working unchanged.

let _sql;
function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not configured');
    _sql = neon(url);
  }
  return _sql;
}

const SELECT = `
  SELECT id::text,
         employee,
         to_char(start_date, 'YYYY-MM-DD') AS "startDate",
         to_char(end_date,   'YYYY-MM-DD') AS "endDate",
         type,
         note,
         to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "createdAt"
  FROM conges_leaves
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const sql = getSql();

  try {
    if (req.method === 'GET') {
      const rows = await sql(SELECT + ' ORDER BY start_date, id');
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { employee, startDate, endDate, type, note } = body;
      if (!employee || !startDate || !endDate || !type) {
        res.status(400).json({ error: 'employee, startDate, endDate and type are required' });
        return;
      }
      if (startDate > endDate) {
        res.status(400).json({ error: 'startDate must be <= endDate' });
        return;
      }
      const rows = await sql(
        `INSERT INTO conges_leaves (employee, start_date, end_date, type, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
        [employee, startDate, endDate, type, note || null]
      );
      res.status(201).json({ id: rows[0].id });
      return;
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id) {
        res.status(400).json({ error: 'id query param required' });
        return;
      }
      await sql('DELETE FROM conges_leaves WHERE id = $1', [id]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('leaves api error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
