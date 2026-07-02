# Migrations base de données (Neon)

Le schéma est géré manuellement (pas d'outil de migration — l'app est petite).
Chaque bloc ci-dessous est **idempotent** et doit être appliqué sur la base
Neon (`DATABASE_URL`) **avant** de merger le code qui en dépend.

## 2026-07-01 — v1 : table des congés (PR #1)

```sql
CREATE TABLE IF NOT EXISTS conges_leaves (
  id         BIGSERIAL PRIMARY KEY,
  employee   TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  type       TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Statut : ✅ appliqué en production.**

## 2026-07-02 — v2 : roster + workflow d'approbation

```sql
-- Roster : équipes, rôles, emails (notifications)
CREATE TABLE IF NOT EXISTS conges_employees (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  email      TEXT,
  team       TEXT NOT NULL DEFAULT 'Marketing',
  role       TEXT NOT NULL DEFAULT 'employee'
             CHECK (role IN ('employee','manager','admin')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow : les lignes existantes restent 'approved' (comportement historique)
ALTER TABLE conges_leaves ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE conges_leaves ADD COLUMN IF NOT EXISTS decided_by TEXT;
ALTER TABLE conges_leaves ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
```

Seed : les 22 membres de l'équipe Marketing + Laure COHEN (`role='admin'`),
tous `team='Marketing'`, emails vides (à renseigner dans l'onglet **Équipe**).

**Statut : ✅ appliqué en production** (avant l'ouverture de la PR — l'API v1
en ligne ignore simplement les nouvelles colonnes/table, donc pas de rupture
pendant la fenêtre de déploiement).

## Ordre de déploiement

1. Appliquer le SQL sur Neon (idempotent, sans rupture pour l'ancien code).
2. Merger / pousser — Vercel déploie front + fonctions de façon atomique.
3. Rollback : revert du commit ; les colonnes/tables supplémentaires sont
   inoffensives pour l'ancien code (il ne les lit pas).
