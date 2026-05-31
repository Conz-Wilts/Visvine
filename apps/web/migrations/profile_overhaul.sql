-- Profile Overhaul Migration
-- Adds extended profile fields to people table and creates new relational tables
--
-- NOTE (superseded): the four relational tables further down were later
-- removed from schema.prisma. The live, Prisma-mapped tables were
-- work_experience / education / certifications / profile_languages; to drop
-- them from an existing DB, run remove_moderator_and_profile_subentities.sql.
--
-- Also note: this legacy hand-SQL predates Person's `@@map("persons")` and
-- targets a `people` table. That is NOT what `prisma db push` applies — the
-- Prisma source-of-truth maps Person to `persons`, so push produces `persons`,
-- not `people`. The `ALTER TABLE people …` columns immediately below therefore
-- only ever touched this legacy table, not the live `persons` table.

-- 1. Extend people table with new optional columns
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS twitter_url    TEXT,
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS pronouns       TEXT,
  ADD COLUMN IF NOT EXISTS open_to_work   BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Work experience
CREATE TABLE IF NOT EXISTS work_experiences (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  person_id   TEXT        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  company     TEXT        NOT NULL,
  location    TEXT,
  start_date  TEXT        NOT NULL,
  end_date    TEXT,
  current     BOOLEAN     NOT NULL DEFAULT FALSE,
  description TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_experiences_person_id ON work_experiences(person_id);

-- 3. Education
CREATE TABLE IF NOT EXISTS education (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  person_id      TEXT        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  school         TEXT        NOT NULL,
  degree         TEXT,
  field_of_study TEXT,
  start_year     INTEGER,
  end_year       INTEGER,
  description    TEXT,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_education_person_id ON education(person_id);

-- 4. Certifications
CREATE TABLE IF NOT EXISTS certifications (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  person_id      TEXT        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  issuing_org    TEXT        NOT NULL,
  issue_date     TEXT,
  expiry_date    TEXT,
  credential_id  TEXT,
  credential_url TEXT,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_certifications_person_id ON certifications(person_id);

-- 5. Profile languages
CREATE TABLE IF NOT EXISTS profile_languages (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  person_id   TEXT        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  language    TEXT        NOT NULL,
  proficiency TEXT        NOT NULL DEFAULT 'conversational',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profile_languages_person_id ON profile_languages(person_id);
