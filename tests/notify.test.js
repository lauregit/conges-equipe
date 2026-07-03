import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sendEmail, requestEmail, decisionEmail } from '../api/_notify.js'

const LEAVE = { employee: 'Lucas DOSSO', startDate: '2026-08-01', endDate: '2026-08-05', type: 'conge_paye', note: 'plage' }

function makeFetch(status = 202) {
  const fetchImpl = async (url, opts) => {
    fetchImpl.calls.push({ url, opts })
    return { ok: status < 300, status, text: async () => '' }
  }
  fetchImpl.calls = []
  return fetchImpl
}

describe('sendEmail', () => {
  let saved
  beforeEach(() => { saved = process.env.SENDGRID_API_KEY })
  afterEach(() => {
    if (saved !== undefined) process.env.SENDGRID_API_KEY = saved
    else delete process.env.SENDGRID_API_KEY
  })

  it('no-ops (false) without an API key, without calling fetch', async () => {
    delete process.env.SENDGRID_API_KEY
    const f = makeFetch()
    expect(await sendEmail({ to: 'a@b.fr', subject: 's', text: 't' }, f)).toBe(false)
    expect(f.calls).toHaveLength(0)
  })

  it('no-ops (false) with no recipients', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test'
    const f = makeFetch()
    expect(await sendEmail({ to: [], subject: 's', text: 't' }, f)).toBe(false)
    expect(await sendEmail({ to: null, subject: 's', text: 't' }, f)).toBe(false)
    expect(f.calls).toHaveLength(0)
  })

  it('sends with the pinned verified sender and correct payload', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test'
    const f = makeFetch()
    const ok = await sendEmail({ to: ['a@b.fr', 'c@d.fr'], subject: 'Sujet', text: 'Corps' }, f)
    expect(ok).toBe(true)
    expect(f.calls[0].url).toBe('https://api.sendgrid.com/v3/mail/send')
    const payload = JSON.parse(f.calls[0].opts.body)
    expect(payload.from.email).toBe('yvalensi@gmail.com') // ONLY verified sender
    expect(payload.personalizations[0].to).toEqual([{ email: 'a@b.fr' }, { email: 'c@d.fr' }])
    expect(payload.subject).toBe('Sujet')
    expect(f.calls[0].opts.headers.Authorization).toBe('Bearer SG.test')
  })

  it('returns false (never throws) when SendGrid errors or is unreachable', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test'
    expect(await sendEmail({ to: 'a@b.fr', subject: 's', text: 't' }, makeFetch(500))).toBe(false)
    const boom = async () => { throw new Error('offline') }
    expect(await sendEmail({ to: 'a@b.fr', subject: 's', text: 't' }, boom)).toBe(false)
  })
})

describe('email templates', () => {
  it("requestEmail 'pending' asks for approval and names the employee", () => {
    const m = requestEmail(LEAVE, 'pending')
    expect(m.subject).toMatch(/à approuver/i)
    expect(m.subject).toContain('Lucas DOSSO')
    expect(m.text).toContain('du 2026-08-01 au 2026-08-05')
    expect(m.text).toContain('plage')
  })

  it("requestEmail 'declared' announces the absence", () => {
    const m = requestEmail({ ...LEAVE, type: 'maladie' }, 'declared')
    expect(m.subject).toMatch(/absence déclarée/i)
    expect(m.text).toMatch(/maladie/i)
  })

  it("requestEmail 'recorded' is an FYI, not an approval request", () => {
    const m = requestEmail(LEAVE, 'recorded')
    expect(m.subject).toMatch(/congé enregistré/i)
    expect(m.text).not.toMatch(/approuver/i)
  })

  it('single-day ranges read as "le <date>"', () => {
    const m = requestEmail({ ...LEAVE, endDate: LEAVE.startDate }, 'pending')
    expect(m.text).toContain('le 2026-08-01')
  })

  it('decisionEmail reflects approval and rejection', () => {
    expect(decisionEmail(LEAVE, 'approve', 'Marc').subject).toMatch(/approuvée/i)
    expect(decisionEmail(LEAVE, 'reject', 'Marc').subject).toMatch(/refusée/i)
    expect(decisionEmail(LEAVE, 'approve', 'Marc').text).toContain('Marc')
  })
})
