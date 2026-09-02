import { describe, it, expect } from 'vitest'
import handler from '../api/payroll-export.js'

const ROSTER = [
  { name: 'Eden KTORZA', team: 'Customer Success', email: 'eden@certideal.com' },
]
const CONFIG = { extraApprovers: {}, globalAdmins: ['Laure COHEN', 'Yoann VALENSI'] }

const APPROVED = {
  employee: 'Eden KTORZA', startDate: '2026-03-01', endDate: '2026-03-05',
  type: 'conge_paye', status: 'approved',
}

function makeDb(rows = []) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    if (/SELECT name, status FROM conges_profiles/i.test(query)) return sql.profile ? [sql.profile] : []
    if (/SELECT employee/i.test(query)) return rows
    return []
  }
  sql.calls = []
  return sql
}

function mockRes() {
  return {
    statusCode: 0, body: undefined, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    json(o) { this.body = o; return this },
    end(o) { this.ended = true; if (o !== undefined) this.body = o; return this },
  }
}

async function call(query, { as = 'Laure COHEN', email = 'laure@certideal.com', rows = [] } = {}) {
  const res = mockRes()
  const sql = makeDb(rows)
  sql.profile = { name: as, status: 'approved' }
  const verify = async () => ({ uid: 'uid-1', email })
  await handler(
    { method: 'GET', headers: { authorization: 'Bearer fake' }, query },
    res,
    { sql, roster: ROSTER, config: CONFIG, verify }
  )
  return { res, sql }
}

describe('GET /api/payroll-export', () => {
  it('réservé aux admins globaux → 403 pour les autres', async () => {
    const { res } = await call({ from: '2026-03-01', to: '2026-03-31' }, { as: 'Eden KTORZA', email: 'eden@certideal.com' })
    expect(res.statusCode).toBe(403)
  })

  it('paramètres from/to requis et bien formés', async () => {
    expect((await call({})).res.statusCode).toBe(400)
    expect((await call({ from: '2026-03-01' })).res.statusCode).toBe(400)
    expect((await call({ from: '2026-03-31', to: '2026-03-01' })).res.statusCode).toBe(400) // inversé
  })

  it('admin global → 200, CSV avec en-tête + les jours de la période', async () => {
    const { res } = await call({ from: '2026-03-01', to: '2026-03-31' }, { rows: [APPROVED] })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toMatch(/text\/csv/)
    expect(res.headers['Content-Disposition']).toContain('variables-paie_2026-03-01_2026-03-31.csv')
    expect(res.body).toContain('Nom;Email;Équipe')
    expect(res.body).toContain('Eden KTORZA;eden@certideal.com;Customer Success;5;0;0')
  })
})
