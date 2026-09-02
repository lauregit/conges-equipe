import { neon } from '@neondatabase/serverless';
import { requireProfile } from './_auth.js';
import { loadConfig, BOOTSTRAP_ADMIN_EMAILS } from './_config.js';
import { loadRoster } from './_rhroster.js';
import { isGlobalAdmin } from '../src/leavePolicy.js';
import { payrollSummary, payrollCsv } from '../src/payroll.js';

// GET /api/payroll-export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Export CSV des variables de paie (congé payé / sans solde / arrêt
// maladie, en jours, par salarié) pour la période demandée — réservé aux
// admins globaux (Laure/Yoann). Voir src/payroll.js pour l'agrégation
// (fonctions pures, testées séparément).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  if (!_sql) _sql = neon(url);
  return _sql;
}

export default async function handler(req, res, overrides = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const sql = overrides.sql || getSql();
    const me = await requireProfile(req, res, sql, overrides.verify);
    if (!me) return;

    const config = overrides.config || await loadConfig(sql);
    const isAdmin = isGlobalAdmin(me.name, config) || BOOTSTRAP_ADMIN_EMAILS.includes(me.email);
    if (!isAdmin) {
      res.status(403).json({ error: 'Export réservé aux admins globaux' });
      return;
    }

    const from = req.query?.from;
    const to = req.query?.to;
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
      res.status(400).json({ error: 'Paramètres from/to requis (YYYY-MM-DD)' });
      return;
    }
    if (from > to) {
      res.status(400).json({ error: 'from doit précéder to' });
      return;
    }

    const roster = overrides.roster || await loadRoster();
    const rows = await sql(
      `SELECT employee,
              to_char(start_date, 'YYYY-MM-DD') AS "startDate",
              to_char(end_date,   'YYYY-MM-DD') AS "endDate",
              type, status
       FROM conges_leaves
       WHERE status = 'approved' AND end_date >= $1 AND start_date <= $2`,
      [from, to]
    );

    const summary = payrollSummary(rows, roster, from, to);
    const csv = payrollCsv(summary);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="variables-paie_${from}_${to}.csv"`);
    res.status(200).end('﻿' + csv); // BOM : accents lisibles à l'ouverture directe dans Excel
  } catch (err) {
    console.error('payroll-export error:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
