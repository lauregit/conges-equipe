import { describe, it, expect } from 'vitest'
import handler from './leaves.js'
import { EMPLOYEES, ADMIN_NAME } from '../src/employees.js'

const EMP = EMPLOYEES[0]        // a valid roster member
const OTHER = EMPLOYEES[1]      // a different valid member

// Records every query and returns canned rows based on the statement kind.
function makeSql(handlers = {}) {
  const sql = async (query, params) => {
    sql.calls.push({ query, params })
    if (/^\s*INSERT/i.test(query)) return handlers.insert ?? [{ id: '42' }]
    if (/SELECT\s+employee\s+FROM/i.test(query)) return handlers.owner ?? []
    if (/^\s*DELETE/i.test(query)) return handlers.del ?? []
    if (/SELECT\s+id::text/i.test(query)) return handlers.list ?? []
    return []
  }
  sql.calls = []
  return sql
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

const validLeave = { employee: EMP, startDate: '2026-08-01', endDate: '2026-08-05', type: 'conge_paye' }

describe('OPTIONS + CORS', () => {
  it('answers preflight with 204 and CORS headers', async () => {
    const res = mockRes()
    await handler({ method: 'OPTIONS' }, res)
    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.ended).toBe(true)
  })
})

describe('GET', () => {
  it('returns rows ordered by start_date', async () => {
    const sql = makeSql({ list: [{ id: '1' }] })
    const res = mockRes()
    await handler({ method: 'GET' }, res, sql)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual([{ id: '1' }])
    expect(sql.calls[0].query).toMatch(/ORDER BY start_date/)
  })
})

describe('POST validation', () => {
  it('inserts a valid leave and returns 201 with the id', async () => {
    const sql = makeSql()
    const res = mockRes()
    await handler({ method: 'POST', body: validLeave }, res, sql)
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ id: '42' })
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params).toEqual([EMP, '2026-08-01', '2026-08-05', 'conge_paye', null])
  })

  it('rejects a malformed JSON string body with 400', async () => {
    const sql = makeSql()
    const res = mockRes()
    await handler({ method: 'POST', body: '{ not valid json' }, res, sql)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/JSON/i)
    expect(sql.calls.some(c => /INSERT/i.test(c.query))).toBe(false)
  })

  it('rejects a non-string note with 400', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, note: { evil: true } } }, res, makeSql())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/note/i)
  })

  it('accepts a JSON string body (raw request)', async () => {
    const sql = makeSql()
    const res = mockRes()
    await handler({ method: 'POST', body: JSON.stringify(validLeave) }, res, sql)
    expect(res.statusCode).toBe(201)
  })

  it('rejects a missing field with 400', async () => {
    const sql = makeSql()
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, type: undefined } }, res, sql)
    expect(res.statusCode).toBe(400)
    expect(sql.calls.some(c => /INSERT/i.test(c.query))).toBe(false)
  })

  it('rejects an employee not on the roster with 400', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, employee: 'Mallory HACKER' } }, res, makeSql())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/inconnu/i)
  })

  it('rejects an invalid leave type with 400', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, type: 'sabbatical' } }, res, makeSql())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/type/i)
  })

  it('rejects malformed / impossible dates with 400', async () => {
    // malformed syntax + semantically impossible calendar dates (Feb 31, etc.)
    const bad = ['2026-13-45', 'not-a-date', '2026-2-1', '20260201', '2026-02-31', '2026-04-31', '2026-00-10']
    for (const value of bad) {
      const res = mockRes()
      await handler({ method: 'POST', body: { ...validLeave, startDate: value } }, res, makeSql())
      expect(res.statusCode, `date ${value}`).toBe(400)
    }
  })

  it('rejects startDate after endDate with 400', async () => {
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, startDate: '2026-08-10', endDate: '2026-08-05' } }, res, makeSql())
    expect(res.statusCode).toBe(400)
  })

  it('trims and caps the note at 200 chars', async () => {
    const sql = makeSql()
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, note: '  ' + 'x'.repeat(250) + '  ' } }, res, sql)
    expect(res.statusCode).toBe(201)
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params[4].length).toBe(200)
  })

  it('stores an empty/whitespace note as null', async () => {
    const sql = makeSql()
    const res = mockRes()
    await handler({ method: 'POST', body: { ...validLeave, note: '   ' } }, res, sql)
    const insert = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(insert.params[4]).toBe(null)
  })
})

describe('DELETE ownership', () => {
  it('requires an id (400)', async () => {
    const res = mockRes()
    await handler({ method: 'DELETE', query: {} }, res, makeSql())
    expect(res.statusCode).toBe(400)
  })

  it('forbids deletion when the user param is missing (403)', async () => {
    const sql = makeSql({ owner: [{ employee: EMP }] })
    const res = mockRes()
    await handler({ method: 'DELETE', query: { id: '7' } }, res, sql)
    expect(res.statusCode).toBe(403)
    expect(sql.calls.some(c => /^\s*DELETE/i.test(c.query))).toBe(false)
  })

  it('forbids deleting another employee\'s leave (403)', async () => {
    const sql = makeSql({ owner: [{ employee: OTHER }] })
    const res = mockRes()
    await handler({ method: 'DELETE', query: { id: '7', user: EMP } }, res, sql)
    expect(res.statusCode).toBe(403)
    expect(sql.calls.some(c => /^\s*DELETE/i.test(c.query))).toBe(false)
  })

  it('lets the owner delete their own leave (200)', async () => {
    const sql = makeSql({ owner: [{ employee: EMP }] })
    const res = mockRes()
    await handler({ method: 'DELETE', query: { id: '7', user: EMP } }, res, sql)
    expect(res.statusCode).toBe(200)
    expect(sql.calls.some(c => /^\s*DELETE/i.test(c.query))).toBe(true)
  })

  it('lets the admin delete anyone\'s leave (200)', async () => {
    const sql = makeSql({ owner: [{ employee: OTHER }] })
    const res = mockRes()
    await handler({ method: 'DELETE', query: { id: '7', user: ADMIN_NAME } }, res, sql)
    expect(res.statusCode).toBe(200)
  })

  it('treats an already-deleted row as success (200, idempotent)', async () => {
    const sql = makeSql({ owner: [] })
    const res = mockRes()
    await handler({ method: 'DELETE', query: { id: '999', user: EMP } }, res, sql)
    expect(res.statusCode).toBe(200)
    expect(sql.calls.some(c => /^\s*DELETE/i.test(c.query))).toBe(false)
  })
})

describe('error handling', () => {
  it('returns 405 for unsupported methods', async () => {
    const res = mockRes()
    await handler({ method: 'PUT' }, res, makeSql())
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
