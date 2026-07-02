import { describe, it, expect } from 'vitest'
import handler from '../api/employees.js'

const ROSTER = [
  { id: '1', name: 'Laure COHEN', email: 'laure@x.fr', team: 'Marketing', role: 'admin', active: true },
  { id: '3', name: 'Lucas DOSSO', email: null, team: 'Marketing', role: 'employee', active: true },
]

function makeDb(roster = ROSTER) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    const q = query.replace(/\s+/g, ' ')
    if (/WHERE name = \$1 AND id <>/i.test(q))
      return roster.filter(r => r.name === params[0] && r.id !== params[1]).map(() => ({ ok: 1 }))
    if (/SELECT 1 FROM conges_employees/i.test(q))
      return roster.filter(r => r.name === params[0] && r.role === 'admin' && r.active).map(() => ({ ok: 1 }))
    if (/UPDATE conges_employees/i.test(q)) {
      const found = roster.find(r => r.id === params[0])
      return found ? [{ ...found, name: params[1] }] : []
    }
    if (/INSERT INTO conges_employees/i.test(q))
      return [{ id: '99', name: params[0], email: params[1], team: params[2], role: params[3], active: params[4] }]
    if (/FROM conges_employees/i.test(q)) return roster
    return []
  }
  sql.calls = []
  return sql
}

function mockRes() {
  return {
    statusCode: 0, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(o) { this.body = o; return this },
    end() { return this },
  }
}

async function call(req, sql = makeDb()) {
  const res = mockRes()
  await handler(req, res, sql)
  return { res, sql }
}

const NEW_PERSON = { name: 'Zoé NEW', email: 'zoe@x.fr', team: 'Tech', role: 'employee', active: true }

describe('GET', () => {
  it('returns the full roster ordered by team, name', async () => {
    const { res, sql } = await call({ method: 'GET' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(sql.calls[0].query).toMatch(/ORDER BY team, name/)
  })
})

describe('POST — admin guard', () => {
  it('forbids a non-admin actor (403)', async () => {
    const { res, sql } = await call({ method: 'POST', body: { actor: 'Lucas DOSSO', employee: NEW_PERSON } })
    expect(res.statusCode).toBe(403)
    expect(sql.calls.some(c => /INSERT|UPDATE/i.test(c.query))).toBe(false)
  })

  it('forbids an unknown actor (403)', async () => {
    const { res } = await call({ method: 'POST', body: { actor: 'Mallory', employee: NEW_PERSON } })
    expect(res.statusCode).toBe(403)
  })

  it('lets an admin insert a new person (201)', async () => {
    const { res, sql } = await call({ method: 'POST', body: { actor: 'Laure COHEN', employee: NEW_PERSON } })
    expect(res.statusCode).toBe(201)
    expect(res.body.name).toBe('Zoé NEW')
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params).toEqual(['Zoé NEW', 'zoe@x.fr', 'Tech', 'employee', true])
  })

  it('lets an admin update an existing person by id (200)', async () => {
    const { res, sql } = await call({
      method: 'POST',
      body: { actor: 'Laure COHEN', employee: { ...NEW_PERSON, id: '3', name: 'Lucas DOSSO' } },
    })
    expect(res.statusCode).toBe(200)
    expect(sql.calls.some(c => /UPDATE conges_employees/i.test(c.query))).toBe(true)
  })

  it('404s when updating a missing id', async () => {
    const { res } = await call({
      method: 'POST',
      body: { actor: 'Laure COHEN', employee: { ...NEW_PERSON, id: '777' } },
    })
    expect(res.statusCode).toBe(404)
  })

  it('409s when renaming to a name that already exists on another row', async () => {
    const { res, sql } = await call({
      method: 'POST',
      body: { actor: 'Laure COHEN', employee: { ...NEW_PERSON, id: '3', name: 'Laure COHEN' } },
    })
    expect(res.statusCode).toBe(409)
    expect(sql.calls.some(c => /UPDATE conges_employees/i.test(c.query))).toBe(false)
  })
})

describe('POST — validation', () => {
  const asAdmin = employee => call({ method: 'POST', body: { actor: 'Laure COHEN', employee } })

  it('rejects a missing name (400)', async () => {
    const { res } = await asAdmin({ ...NEW_PERSON, name: '   ' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid role (400)', async () => {
    const { res } = await asAdmin({ ...NEW_PERSON, role: 'ceo' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid email (400)', async () => {
    const { res } = await asAdmin({ ...NEW_PERSON, email: 'not-an-email' })
    expect(res.statusCode).toBe(400)
  })

  it('accepts an empty email (stored as null)', async () => {
    const { res, sql } = await asAdmin({ ...NEW_PERSON, email: '' })
    expect(res.statusCode).toBe(201)
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params[1]).toBe(null)
  })

  it('rejects malformed JSON (400)', async () => {
    const { res } = await call({ method: 'POST', body: '{ nope' })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a missing employee payload (400)', async () => {
    const { res } = await call({ method: 'POST', body: { actor: 'Laure COHEN' } })
    expect(res.statusCode).toBe(400)
  })
})
