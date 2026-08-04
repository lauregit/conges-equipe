import { describe, it, expect } from 'vitest'
import handler from '../api/leaves.js'

// Roster fixture façon RH Compliance (le handler reçoit rosterOverride —
// pas d'accès réseau ni base dans les tests).
const ROSTER = [
  { name: 'Lucas DOSSO', team: 'Marketing', manager: true },
  { name: 'Salvatore MACRI', team: 'Marketing', manager: false },
  { name: 'Christophe PROT', team: 'Tech', manager: true },
  { name: 'Claire HUANG', team: 'Tech', manager: false },
]

const PENDING = {
  id: '7', employee: 'Salvatore MACRI', startDate: '2026-09-01', endDate: '2026-09-05',
  type: 'conge_paye', note: null, status: 'pending', submittedBy: 'Salvatore MACRI',
  decidedBy: null, createdAt: '2026-08-05T10:00:00+00',
}

function makeDb({ byId = [], list = [], owner = [], updateRows } = {}) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    const q = query.replace(/\s+/g, ' ')
    if (/INSERT INTO conges_leaves/i.test(q)) return [{ id: '42' }]
    if (/UPDATE conges_leaves/i.test(q)) return updateRows ?? [{ id: params[0] }]
    if (/DELETE FROM conges_leaves/i.test(q)) return []
    if (/SELECT employee FROM conges_leaves/i.test(q)) return owner
    if (/SELECT id::text/i.test(q) && /WHERE id/i.test(q)) return byId
    if (/SELECT id::text/i.test(q)) return list
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
    end() { this.ended = true; return this },
  }
}

async function call(req, { sql = makeDb(), roster = ROSTER } = {}) {
  const res = mockRes()
  await handler(req, res, sql, roster)
  return { res, sql }
}

const valid = { employee: 'Salvatore MACRI', startDate: '2026-09-01', endDate: '2026-09-05', type: 'conge_paye' }

describe('GET', () => {
  it('liste les congés avec statut, triés par date', async () => {
    const sql = makeDb({ list: [PENDING] })
    const { res } = await call({ method: 'GET' }, { sql })
    expect(res.statusCode).toBe(200)
    expect(res.body[0].status).toBe('pending')
    expect(sql.calls[0].query).toMatch(/ORDER BY start_date/)
  })
})

describe('POST — policy serveur', () => {
  it('demande normale (pôle avec manager) → 201 pending', async () => {
    const { res, sql } = await call({ method: 'POST', body: valid })
    expect(res.statusCode).toBe(201)
    expect(res.body.status).toBe('pending')
    const ins = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(ins.params[5]).toBe('pending')
  })

  it('arrêt maladie → approved (déclaration)', async () => {
    const { res } = await call({ method: 'POST', body: { ...valid, type: 'arret_maladie' } })
    expect(res.body.status).toBe('approved')
  })

  it('saisie PAR le manager POUR un membre → approved + decidedBy', async () => {
    const { res, sql } = await call({ method: 'POST', body: { ...valid, submittedBy: 'Lucas DOSSO' } })
    expect(res.body.status).toBe('approved')
    const ins = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(ins.params[7]).toBe('Lucas DOSSO') // decided_by
  })

  it("saisie pour quelqu'un par un NON-approbateur → 403", async () => {
    const { res } = await call({ method: 'POST', body: { ...valid, submittedBy: 'Claire HUANG' } })
    expect(res.statusCode).toBe(403)
  })

  it('employé hors personnel RH → 400', async () => {
    const { res } = await call({ method: 'POST', body: { ...valid, employee: 'Mallory HACKER' } })
    expect(res.statusCode).toBe(400)
  })

  it('validations : type, dates impossibles, ordre, JSON, note', async () => {
    for (const body of [
      { ...valid, type: 'rtt' },
      { ...valid, startDate: '2026-02-31' },
      { ...valid, startDate: '2026-09-10', endDate: '2026-09-05' },
      { ...valid, note: { evil: true } },
    ]) {
      const { res } = await call({ method: 'POST', body })
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
    }
    const { res } = await call({ method: 'POST', body: '{ pas du json' })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH — décision', () => {
  const patch = (user, action = 'approve', byId = [PENDING], updateRows) =>
    call({ method: 'PATCH', query: { id: '7' }, body: { user, action } }, { sql: makeDb({ byId, updateRows }) })

  it('le manager du pôle approuve → 200', async () => {
    const { res, sql } = await patch('Lucas DOSSO')
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('approved')
    const upd = sql.calls.find(c => /UPDATE/i.test(c.query))
    expect(upd.query).toMatch(/status = 'pending'/) // garde atomique
  })

  it("manager d'un autre pôle → 403 ; soi-même → 403", async () => {
    expect((await patch('Christophe PROT')).res.statusCode).toBe(403)
    expect((await patch('Salvatore MACRI')).res.statusCode).toBe(403)
  })

  it('admin global (Laure) décide partout → 200', async () => {
    const { res } = await patch('Laure COHEN')
    expect(res.statusCode).toBe(200)
  })

  it('introuvable → 404 ; déjà traité → 409 ; course perdue → 409', async () => {
    expect((await patch('Lucas DOSSO', 'approve', [])).res.statusCode).toBe(404)
    expect((await patch('Lucas DOSSO', 'approve', [{ ...PENDING, status: 'approved' }])).res.statusCode).toBe(409)
    expect((await patch('Lucas DOSSO', 'approve', [PENDING], [])).res.statusCode).toBe(409)
  })
})

describe('DELETE — propriété', () => {
  const del = (query, owner = [{ employee: 'Salvatore MACRI' }]) =>
    call({ method: 'DELETE', query }, { sql: makeDb({ owner }) })

  it('propriétaire ok ; admin global ok ; autre → 403 ; sans user → 403', async () => {
    expect((await del({ id: '7', user: 'Salvatore MACRI' })).res.statusCode).toBe(200)
    expect((await del({ id: '7', user: 'Yoann VALENSI' })).res.statusCode).toBe(200)
    expect((await del({ id: '7', user: 'Lucas DOSSO' })).res.statusCode).toBe(403)
    expect((await del({ id: '7' })).res.statusCode).toBe(403)
  })

  it('déjà supprimé → 200 idempotent ; sans id → 400', async () => {
    expect((await del({ id: '99', user: 'X' }, [])).res.statusCode).toBe(200)
    expect((await del({})).res.statusCode).toBe(400)
  })
})

describe('divers', () => {
  it('OPTIONS → 204 CORS ; PUT → 405', async () => {
    const { res } = await call({ method: 'OPTIONS' })
    expect(res.statusCode).toBe(204)
    expect((await call({ method: 'PUT' })).res.statusCode).toBe(405)
  })
})
