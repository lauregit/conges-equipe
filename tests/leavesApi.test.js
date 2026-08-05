import { describe, it, expect } from 'vitest'
import handler from '../api/leaves.js'

// Roster fixture (chaîne : Eden -> superviseur RH Vithusa).
// Eden et Lucas sont binômes de remplacement (lien rh_org, un seul sens suffit).
const ROSTER = [
  { name: 'Vithusa VASIDDAN', team: 'Customer Success', manager: false, supervisor: null, rhSupervisor: null, replacements: [] },
  { name: 'Eden KTORZA', team: 'Customer Success', manager: false, supervisor: 'Vithusa VASIDDAN', rhSupervisor: 'Vithusa VASIDDAN', replacements: ['Lucas DOSSO'] },
  { name: 'Lucas DOSSO', team: 'Marketing', manager: true, supervisor: null, rhSupervisor: null, replacements: [] },
  { name: 'Salvatore MACRI', team: 'Marketing', manager: false, supervisor: null, rhSupervisor: null, replacements: [] },
]

const CONFIG = { extraApprovers: {}, globalAdmins: ['Laure COHEN', 'Yoann VALENSI'] }

const PENDING = {
  id: '7', employee: 'Eden KTORZA', startDate: '2026-09-01', endDate: '2026-09-05',
  type: 'conge_paye', note: null, status: 'pending', submittedBy: 'Eden KTORZA',
  decidedBy: null, createdAt: '2026-08-05T10:00:00+00',
}

// Fake sql : route aussi la lecture du profil (auth).
function makeDb({ byId = [], list = [], owner = [], updateRows, profiles = {} } = {}) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    const q = query.replace(/\s+/g, ' ')
    if (/SELECT name, status FROM conges_profiles/i.test(q)) {
      const p = profiles[params[0]]
      return p ? [p] : []
    }
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

// `as` = nom du profil authentifié (identité vérifiée simulée).
async function call(req, { as = 'Eden KTORZA', sqlOpts = {}, noToken = false, pendingProfile = false } = {}) {
  const res = mockRes()
  const sql = makeDb({
    ...sqlOpts,
    profiles: { 'uid-1': { name: as, status: pendingProfile ? 'pending' : 'approved' } },
  })
  const verify = noToken ? async () => null : async () => ({ uid: 'uid-1', email: 'x@certideal.com' })
  await handler(
    { headers: { authorization: noToken ? '' : 'Bearer fake' }, ...req },
    res,
    { sql, roster: ROSTER, config: CONFIG, verify: noToken ? undefined : verify }
  )
  return { res, sql }
}

const valid = { startDate: '2026-09-01', endDate: '2026-09-05', type: 'conge_paye' }

describe('authentification', () => {
  it('sans jeton → 401', async () => {
    const { res } = await call({ method: 'GET' }, { noToken: true })
    expect(res.statusCode).toBe(401)
  })
  it('profil en attente → 403', async () => {
    const { res } = await call({ method: 'GET' }, { pendingProfile: true })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET — visibilité par chaîne de commandement', () => {
  const rows = [
    PENDING, // Eden (pending)
    { ...PENDING, id: '8', employee: 'Salvatore MACRI', status: 'approved', note: 'secret', type: 'conge_paye' },
    { ...PENDING, id: '9', employee: 'Salvatore MACRI', status: 'pending' },
  ]

  it('chacun voit SES congés en clair ; les autres en silhouette (approuvés, sans type/note)', async () => {
    const { res } = await call({ method: 'GET' }, { as: 'Eden KTORZA', sqlOpts: { list: rows } })
    expect(res.statusCode).toBe(200)
    const mine = res.body.find(l => l.id === '7')
    expect(mine.type).toBe('conge_paye') // en clair (soi-même)
    const other = res.body.find(l => l.id === '8')
    expect(other.restricted).toBe(true)
    expect(other.type).toBe(null)
    expect(other.note).toBe(null)
    // le pending d'autrui hors périmètre est invisible
    expect(res.body.find(l => l.id === '9')).toBeUndefined()
  })

  it('le superviseur voit son sous-arbre en clair', async () => {
    const { res } = await call({ method: 'GET' }, { as: 'Vithusa VASIDDAN', sqlOpts: { list: rows } })
    expect(res.body.find(l => l.id === '7').type).toBe('conge_paye') // Eden = sous-arbre
    expect(res.body.find(l => l.id === '8').restricted).toBe(true)  // Salvatore = hors chaîne
  })

  it('un admin global voit tout en clair', async () => {
    const { res } = await call({ method: 'GET' }, { as: 'Laure COHEN', sqlOpts: { list: rows } })
    expect(res.body).toHaveLength(3)
    expect(res.body.every(l => !l.restricted)).toBe(true)
  })
})

describe('POST — identité du jeton, policy serveur', () => {
  it('demande pour soi → pending vers le superviseur RH ; submittedBy = identité vérifiée', async () => {
    const { res, sql } = await call({ method: 'POST', body: valid })
    expect(res.statusCode).toBe(201)
    expect(res.body.status).toBe('pending')
    const ins = sql.calls.find(c => /INSERT/i.test(c.query))
    expect(ins.params[6]).toBe('Eden KTORZA') // submitted_by = jeton, pas le body
  })

  it('impossible d’usurper : employee ≠ soi sans droits → 403 (même avec submittedBy forgé)', async () => {
    const { res } = await call({
      method: 'POST',
      body: { ...valid, employee: 'Salvatore MACRI', submittedBy: 'Lucas DOSSO' },
    }, { as: 'Eden KTORZA' })
    expect(res.statusCode).toBe(403)
  })

  it('le superviseur RH saisit pour son N-1 → approved', async () => {
    const { res } = await call({
      method: 'POST', body: { ...valid, employee: 'Eden KTORZA' },
    }, { as: 'Vithusa VASIDDAN' })
    expect(res.statusCode).toBe(201)
    expect(res.body.status).toBe('approved')
  })

  it('validations de base (type/date/ordre/json)', async () => {
    for (const body of [
      { ...valid, type: 'rtt' },
      { ...valid, startDate: '2026-02-31' },
      { ...valid, startDate: '2026-09-10', endDate: '2026-09-05' },
    ]) {
      const { res } = await call({ method: 'POST', body })
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('POST — conflit de remplacement (organigramme partagé rh_org)', () => {
  // Lucas (binôme d'Eden) est déjà absent sur des dates qui chevauchent.
  const lucasAbsent = {
    id: '9', employee: 'Lucas DOSSO', startDate: '2026-09-03', endDate: '2026-09-08',
    type: 'conge_paye', note: null, status: 'approved',
    submittedBy: 'Lucas DOSSO', decidedBy: null, createdAt: null,
  }

  it('binôme déjà absent sur les dates → 409, rien n’est inséré', async () => {
    const { res, sql } = await call(
      { method: 'POST', body: valid },
      { sqlOpts: { list: [lucasAbsent] } }
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/remplac/i)
    expect(sql.calls.some(c => /INSERT INTO conges_leaves/i.test(c.query))).toBe(false)
  })

  it('un admin global peut forcer → 201', async () => {
    const { res } = await call(
      { method: 'POST', body: { ...valid, employee: 'Eden KTORZA' } },
      { as: 'Yoann VALENSI', sqlOpts: { list: [lucasAbsent] } }
    )
    expect(res.statusCode).toBe(201)
  })

  it('TT du binôme ou congé rejeté → pas un conflit → 201', async () => {
    const { res } = await call(
      { method: 'POST', body: valid },
      { sqlOpts: { list: [
        { ...lucasAbsent, type: 'teletravail' },
        { ...lucasAbsent, status: 'rejected' },
      ] } }
    )
    expect(res.statusCode).toBe(201)
  })
})

describe('PATCH — décision par le superviseur RH', () => {
  const patch = (as, action = 'approve', byId = [PENDING], updateRows) =>
    call({ method: 'PATCH', query: { id: '7' }, body: { action } }, { as, sqlOpts: { byId, updateRows } })

  it('le superviseur RH approuve → 200 (garde atomique)', async () => {
    const { res, sql } = await patch('Vithusa VASIDDAN')
    expect(res.statusCode).toBe(200)
    expect(sql.calls.find(c => /UPDATE/i.test(c.query)).query).toMatch(/status = 'pending'/)
  })

  it('un non-superviseur → 403 ; soi-même → 403 ; admin global → 200', async () => {
    expect((await patch('Lucas DOSSO')).res.statusCode).toBe(403)
    expect((await patch('Eden KTORZA')).res.statusCode).toBe(403)
    expect((await patch('Yoann VALENSI')).res.statusCode).toBe(200)
  })

  it('404 introuvable ; 409 déjà traité ; 409 course perdue', async () => {
    expect((await patch('Vithusa VASIDDAN', 'approve', [])).res.statusCode).toBe(404)
    expect((await patch('Vithusa VASIDDAN', 'approve', [{ ...PENDING, status: 'approved' }])).res.statusCode).toBe(409)
    expect((await patch('Vithusa VASIDDAN', 'approve', [PENDING], [])).res.statusCode).toBe(409)
  })
})

describe('DELETE', () => {
  const del = (as, owner = [{ employee: 'Eden KTORZA' }]) =>
    call({ method: 'DELETE', query: { id: '7' } }, { as, sqlOpts: { owner } })

  it('propriétaire ok ; admin global ok ; autre → 403', async () => {
    expect((await del('Eden KTORZA')).res.statusCode).toBe(200)
    expect((await del('Laure COHEN')).res.statusCode).toBe(200)
    expect((await del('Vithusa VASIDDAN')).res.statusCode).toBe(403)
  })
})
