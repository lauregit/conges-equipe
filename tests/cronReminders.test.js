import { describe, it, expect } from 'vitest'
import handler from '../api/cron-reminders.js'

const ROSTER = [
  { name: 'Vithusa VASIDDAN', team: 'Customer Success', manager: false, supervisor: null, rhSupervisor: null, email: 'vithusa@certideal.com' },
  { name: 'Eden KTORZA', team: 'Customer Success', manager: false, supervisor: 'Vithusa VASIDDAN', rhSupervisor: 'Vithusa VASIDDAN', email: 'eden@certideal.com' },
  { name: 'Lucas DOSSO', team: 'Marketing', manager: true, supervisor: null, rhSupervisor: null, email: 'lucas@certideal.com' },
]
const CONFIG = { extraApprovers: {}, globalAdmins: ['Laure COHEN', 'Yoann VALENSI'] }

const STALE = {
  id: '7', employee: 'Eden KTORZA', startDate: '2026-09-01', endDate: '2026-09-05',
  type: 'conge_paye', note: null,
}
const MANAGER_SELF = { ...STALE, id: '9', employee: 'Lucas DOSSO' }

function makeDb(rows) {
  const sql = async (query, params = []) => {
    sql.calls.push({ query, params })
    if (/UPDATE conges_leaves SET reminded_at/i.test(query)) return []
    if (/SELECT id::text/i.test(query)) return rows
    return []
  }
  sql.calls = []
  return sql
}

function mockRes() {
  return {
    statusCode: 0, body: undefined,
    status(c) { this.statusCode = c; return this },
    json(o) { this.body = o; return this },
  }
}

async function call(rows, opts = {}) {
  const res = mockRes()
  const sentEmails = []
  const sendEmail = async (msg) => { sentEmails.push(msg); return true }
  const sql = makeDb(rows)
  await handler({ headers: {} }, res, { sql, roster: ROSTER, config: CONFIG, sendEmail, ...opts })
  return { res, sql, sentEmails }
}

describe('cron-reminders', () => {
  it('relance le(s) vrai(s) décideur(s) pour une demande en attente > 48h', async () => {
    const { res, sql, sentEmails } = await call([STALE])
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ checked: 1, sent: 1 })
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toEqual(['vithusa@certideal.com'])
    expect(sentEmails[0].subject).toMatch(/rappel/i)
    const upd = sql.calls.find(c => /UPDATE/i.test(c.query))
    expect(upd.params).toEqual(['7'])
  })

  it('repli direction quand le demandeur est lui-même le seul décideur possible', async () => {
    const { sentEmails } = await call([MANAGER_SELF])
    expect(sentEmails[0].to.sort()).toEqual(['laure@certideal.com', 'yoann@certideal.com'])
  })

  it('aucune demande en retard → rien à faire, aucun email', async () => {
    const { res, sentEmails } = await call([])
    expect(res.body).toEqual({ checked: 0, sent: 0 })
    expect(sentEmails).toHaveLength(0)
  })

  it('employé inconnu du roster : repli direction quand même (jamais de relance silencieusement perdue), et marque reminded_at', async () => {
    const orphan = { ...STALE, id: '11', employee: 'Inconnu DE LA BASE' }
    const { sql, sentEmails } = await call([orphan])
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to.sort()).toEqual(['laure@certideal.com', 'yoann@certideal.com'])
    expect(sql.calls.some(c => /UPDATE conges_leaves SET reminded_at/i.test(c.query) && c.params[0] === '11')).toBe(true)
  })

  it('CRON_SECRET configuré : requête sans le bon jeton → 401, rien envoyé', async () => {
    const res = mockRes()
    const sentEmails = []
    const sql = makeDb([STALE])
    const saved = process.env.CRON_SECRET
    process.env.CRON_SECRET = 's3cret'
    try {
      await handler({ headers: { authorization: 'Bearer wrong' } }, res, {
        sql, roster: ROSTER, config: CONFIG, sendEmail: async (m) => { sentEmails.push(m); return true },
      })
    } finally {
      if (saved !== undefined) process.env.CRON_SECRET = saved
      else delete process.env.CRON_SECRET
    }
    expect(res.statusCode).toBe(401)
    expect(sentEmails).toHaveLength(0)
  })
})
