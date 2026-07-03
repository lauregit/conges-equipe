import { describe, it, expect } from 'vitest'
import handler from '../api/leaves.js'

// --- Fixtures: a small roster with two teams -------------------------------
const ROSTER = [
  { id: '1', name: 'Laure COHEN', email: 'laure@x.fr', team: 'Marketing', role: 'admin', active: true },
  { id: '2', name: 'Marc MANAGER', email: 'marc@x.fr', team: 'Marketing', role: 'manager', active: true },
  { id: '3', name: 'Lucas DOSSO', email: 'lucas@x.fr', team: 'Marketing', role: 'employee', active: true },
  { id: '4', name: 'Nina NOMAIL', email: null, team: 'Marketing', role: 'employee', active: true },
  { id: '5', name: 'Tom TECH', email: 'tom@x.fr', team: 'Tech', role: 'manager', active: true },
  { id: '6', name: 'Ines INACTIVE', email: 'ines@x.fr', team: 'Marketing', role: 'employee', active: false },
]

// Roster-aware fake sql: implements the handler's queries against fixtures.
// `updateRows` simulates the atomic "WHERE status='pending'" UPDATE result:
// default = success (row returned); [] = lost a concurrent decision race.
function makeDb({ roster = ROSTER, byId = [], list = [], owner = [], updateRows } = {}) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    const q = query.replace(/\s+/g, ' ')
    if (/INSERT INTO conges_leaves/i.test(q)) return [{ id: '42' }]
    if (/UPDATE conges_leaves/i.test(q)) return updateRows ?? [{ id: params[0] }]
    if (/DELETE FROM conges_leaves/i.test(q)) return []
    if (/SELECT employee FROM conges_leaves/i.test(q)) return owner
    if (/SELECT id::text/i.test(q) && /WHERE id/i.test(q)) return byId
    if (/SELECT id::text/i.test(q)) return list
    if (/SELECT name, team, role FROM conges_employees/i.test(q))
      return roster.filter(r => r.name === params[0] && r.active).map(({ name, team, role }) => ({ name, team, role }))
    if (/SELECT name, team FROM conges_employees/i.test(q))
      return roster.filter(r => r.name === params[0] && r.active).map(({ name, team }) => ({ name, team }))
    if (/SELECT name, email, team FROM conges_employees/i.test(q))
      return roster.filter(r => r.name === params[0]).map(({ name, email, team }) => ({ name, email, team }))
    if (/SELECT email FROM conges_employees/i.test(q))
      return roster
        .filter(r => r.active && r.email && (r.role === 'admin' || (r.role === 'manager' && r.team === params[0])))
        .map(({ email }) => ({ email }))
    if (/SELECT 1 FROM conges_employees WHERE role = 'manager'/i.test(q))
      return roster.filter(r => r.role === 'manager' && r.team === params[0] && r.active).map(() => ({ ok: 1 }))
    if (/SELECT 1 FROM conges_employees/i.test(q))
      return roster.filter(r => r.name === params[0] && r.role === 'admin' && r.active).map(() => ({ ok: 1 }))
    return []
  }
  sql.calls = []
  return sql
}

function makeNotify() {
  const notify = async (msg) => { notify.sent.push(msg); return true }
  notify.sent = []
  return notify
}

function mockRes() {
  return {
    statusCode: 0,
    body: undefined,
    headers: {},
    ended: false,
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(o) { this.body = o; return this },
    end() { this.ended = true; return this },
  }
}

async function call(req, { sql = makeDb(), notify = makeNotify() } = {}) {
  const res = mockRes()
  await handler(req, res, sql, notify)
  return { res, sql, notify }
}

const validLeave = { employee: 'Lucas DOSSO', startDate: '2026-08-01', endDate: '2026-08-05', type: 'conge_paye' }

const PENDING_LEAVE = {
  id: '7', employee: 'Lucas DOSSO', startDate: '2026-08-01', endDate: '2026-08-05',
  type: 'conge_paye', note: null, status: 'pending', decidedBy: null, createdAt: '2026-07-01T10:00:00+00',
}

describe('OPTIONS + CORS', () => {
  it('answers preflight with 204 and CORS headers', async () => {
    const { res } = await call({ method: 'OPTIONS' })
    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.headers['Access-Control-Allow-Methods']).toContain('PATCH')
    expect(res.ended).toBe(true)
  })
})

describe('GET', () => {
  it('returns rows (with status) ordered by start_date', async () => {
    const sql = makeDb({ list: [PENDING_LEAVE] })
    const { res } = await call({ method: 'GET' }, { sql })
    expect(res.statusCode).toBe(200)
    expect(res.body[0].status).toBe('pending')
    expect(sql.calls[0].query).toMatch(/ORDER BY start_date/)
  })
})

describe('POST — request vs declaration', () => {
  it('creates a PENDING request for conge_paye and notifies team approvers', async () => {
    const { res, sql, notify } = await call({ method: 'POST', body: validLeave })
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ id: '42', status: 'pending' })
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params).toEqual(['Lucas DOSSO', '2026-08-01', '2026-08-05', 'conge_paye', null, 'pending'])
    // Marketing manager + admin get the email; Tech manager does not.
    expect(notify.sent).toHaveLength(1)
    expect(notify.sent[0].to.sort()).toEqual(['laure@x.fr', 'marc@x.fr'])
    expect(notify.sent[0].subject).toMatch(/à approuver/i)
  })

  it('auto-approves an arrêt maladie declaration and notifies FYI', async () => {
    const { res, sql, notify } = await call({ method: 'POST', body: { ...validLeave, type: 'arret_maladie' } })
    expect(res.statusCode).toBe(201)
    expect(res.body.status).toBe('approved')
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params[5]).toBe('approved')
    expect(notify.sent[0].subject).toMatch(/absence déclarée/i)
  })

  it('accepts all of Laure’s leave types', async () => {
    for (const type of ['conge_paye', 'conge_sans_solde', 'teletravail', 'arret_maladie']) {
      const { res } = await call({ method: 'POST', body: { ...validLeave, type } })
      expect(res.statusCode, `type ${type}`).toBe(201)
    }
  })

  it('rejects a removed legacy type (rtt) with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, type: 'rtt' } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an employee not in the DB roster with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, employee: 'Mallory HACKER' } })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/inconnu/i)
  })

  it('rejects a deactivated employee with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, employee: 'Ines INACTIVE' } })
    expect(res.statusCode).toBe(400)
  })

  it('succeeds without notifying when no approver has an email', async () => {
    const bare = ROSTER.map(r => ({ ...r, email: null }))
    const { res, notify } = await call({ method: 'POST', body: validLeave }, { sql: makeDb({ roster: bare }) })
    expect(res.statusCode).toBe(201)
    expect(notify.sent).toHaveLength(0)
  })

  it("records immediately (Laure's historic flow) when the team has NO manager", async () => {
    // Approval is opt-in: without a manager on the team, a congé is approved
    // directly and approvers with email get an FYI, not a request.
    const noManagers = ROSTER.map(r => r.role === 'manager' ? { ...r, role: 'employee' } : r)
    const { res, sql, notify } = await call({ method: 'POST', body: validLeave }, { sql: makeDb({ roster: noManagers }) })
    expect(res.statusCode).toBe(201)
    expect(res.body.status).toBe('approved')
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params[5]).toBe('approved')
    expect(notify.sent[0].subject).toMatch(/congé enregistré/i)
  })
})

describe('POST — validation', () => {
  it('accepts a JSON string body (raw request)', async () => {
    const { res } = await call({ method: 'POST', body: JSON.stringify(validLeave) })
    expect(res.statusCode).toBe(201)
  })

  it('rejects a malformed JSON string body with 400', async () => {
    const { res, sql } = await call({ method: 'POST', body: '{ not valid json' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/JSON/i)
    expect(sql.calls).toHaveLength(0)
  })

  it('rejects a missing field with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, type: undefined } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-string note with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, note: { evil: true } } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid leave type with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, type: 'sabbatical' } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects malformed / impossible dates with 400', async () => {
    const bad = ['2026-13-45', 'not-a-date', '2026-2-1', '20260201', '2026-02-31', '2026-04-31', '2026-00-10']
    for (const value of bad) {
      const { res } = await call({ method: 'POST', body: { ...validLeave, startDate: value } })
      expect(res.statusCode, `date ${value}`).toBe(400)
    }
  })

  it('rejects startDate after endDate with 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...validLeave, startDate: '2026-08-10', endDate: '2026-08-05' } })
    expect(res.statusCode).toBe(400)
  })

  it('trims and caps the note at 200 chars', async () => {
    const { res, sql } = await call({ method: 'POST', body: { ...validLeave, note: '  ' + 'x'.repeat(250) + '  ' } })
    expect(res.statusCode).toBe(201)
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params[4].length).toBe(200)
  })
})

describe('PATCH — approval decisions', () => {
  const patch = (user, action = 'approve', byId = [PENDING_LEAVE]) =>
    call({ method: 'PATCH', query: { id: '7' }, body: { user, action } }, { sql: makeDb({ byId }) })

  it('lets the team manager approve; records decision and notifies the owner', async () => {
    const { res, sql, notify } = await patch('Marc MANAGER')
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('approved')
    const upd = sql.calls.find(c => /UPDATE conges_leaves/i.test(c.query))
    expect(upd.params).toEqual(['7', 'approved', 'Marc MANAGER'])
    expect(notify.sent[0].to).toBe('lucas@x.fr')
    expect(notify.sent[0].subject).toMatch(/approuvée/i)
  })

  it('lets the team manager reject; owner is notified of the refusal', async () => {
    const { res, notify } = await patch('Marc MANAGER', 'reject')
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('rejected')
    expect(notify.sent[0].subject).toMatch(/refusée/i)
  })

  it('forbids a manager from another team (403)', async () => {
    const { res } = await patch('Tom TECH')
    expect(res.statusCode).toBe(403)
  })

  it('forbids a plain employee (403)', async () => {
    const { res } = await patch('Nina NOMAIL')
    expect(res.statusCode).toBe(403)
  })

  it('forbids a manager deciding their own request (403)', async () => {
    const own = { ...PENDING_LEAVE, employee: 'Marc MANAGER' }
    const { res } = await patch('Marc MANAGER', 'approve', [own])
    expect(res.statusCode).toBe(403)
  })

  it('lets an admin decide anything, even cross-team', async () => {
    const tech = { ...PENDING_LEAVE, employee: 'Tom TECH' }
    const { res } = await patch('Laure COHEN', 'approve', [tech])
    expect(res.statusCode).toBe(200)
  })

  it('404s on an unknown request', async () => {
    const { res } = await patch('Marc MANAGER', 'approve', [])
    expect(res.statusCode).toBe(404)
  })

  it('409s when the request was already decided', async () => {
    const done = { ...PENDING_LEAVE, status: 'approved' }
    const { res } = await patch('Marc MANAGER', 'approve', [done])
    expect(res.statusCode).toBe(409)
  })

  it('409s when losing a concurrent decision race (atomic UPDATE guard)', async () => {
    // Read said pending, but another decision landed first: UPDATE matches 0 rows.
    const sql = makeDb({ byId: [PENDING_LEAVE], updateRows: [] })
    const { res, notify } = await call(
      { method: 'PATCH', query: { id: '7' }, body: { user: 'Marc MANAGER', action: 'reject' } },
      { sql }
    )
    expect(res.statusCode).toBe(409)
    expect(notify.sent).toHaveLength(0) // the loser must not email the owner
  })

  it('400s on a bad action', async () => {
    const { res } = await call({ method: 'PATCH', query: { id: '7' }, body: { user: 'Marc MANAGER', action: 'maybe' } })
    expect(res.statusCode).toBe(400)
  })

  it('still succeeds when the owner has no email (no notification)', async () => {
    const nina = { ...PENDING_LEAVE, employee: 'Nina NOMAIL' }
    const { res, notify } = await patch('Marc MANAGER', 'approve', [nina])
    expect(res.statusCode).toBe(200)
    expect(notify.sent).toHaveLength(0)
  })
})

describe('DELETE — ownership', () => {
  const del = (query, owner = [{ employee: 'Lucas DOSSO' }]) =>
    call({ method: 'DELETE', query }, { sql: makeDb({ owner }) })

  it('requires an id (400)', async () => {
    const { res } = await del({})
    expect(res.statusCode).toBe(400)
  })

  it('lets the owner delete their own leave', async () => {
    const { res, sql } = await del({ id: '7', user: 'Lucas DOSSO' })
    expect(res.statusCode).toBe(200)
    expect(sql.calls.some(c => /^\s*DELETE/i.test(c.query))).toBe(true)
  })

  it('lets a DB admin delete anyone’s leave', async () => {
    const { res } = await del({ id: '7', user: 'Laure COHEN' })
    expect(res.statusCode).toBe(200)
  })

  it('forbids a non-owner non-admin (403)', async () => {
    const { res, sql } = await del({ id: '7', user: 'Marc MANAGER' })
    expect(res.statusCode).toBe(403)
    expect(sql.calls.some(c => /^\s*DELETE/i.test(c.query))).toBe(false)
  })

  it('forbids when the user param is missing (403)', async () => {
    const { res } = await del({ id: '7' })
    expect(res.statusCode).toBe(403)
  })

  it('treats an already-deleted row as success (idempotent)', async () => {
    const { res } = await del({ id: '999', user: 'Lucas DOSSO' }, [])
    expect(res.statusCode).toBe(200)
  })
})

describe('error handling', () => {
  it('returns 405 for unsupported methods', async () => {
    const { res } = await call({ method: 'PUT' })
    expect(res.statusCode).toBe(405)
  })

  it('returns 500 when DATABASE_URL is not configured (no injected sql)', async () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const res = mockRes()
      await handler({ method: 'GET' }, res) // no sqlOverride -> getSql() throws
      expect(res.statusCode).toBe(500)
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
    }
  })
})
