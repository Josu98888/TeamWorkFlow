-- One-off setup of the module schemas and roles on Supabase (free Postgres).
-- Local and compose databases use backend/postgres/init/01-schemas-and-roles.sh instead.
--
-- Run it ONCE as the `postgres` user, from the DIRECT or SESSION connection (not the
-- transaction pooler), with one password per role as psql variables. It is idempotent:
-- running it again keeps the roles and schemas and resets their passwords.
--
--   psql "postgresql://postgres.<projectref>:<postgres-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" \
--     -v ON_ERROR_STOP=1 \
--     -v auth_pass='...' -v organization_pass='...' -v tasks_pass='...' \
--     -v notifications_pass='...' -v billing_pass='...' -v attendance_pass='...' \
--     -f backend/postgres/supabase/01-schemas-and-roles.sql
--
-- Creates, per module <m> in (auth, organization, tasks, notifications, billing,
-- attendance): role tw_<m>_svc (LOGIN, no superuser) and schema tw_<m> owned by it, with
-- search_path = tw_<m>. The `tw_` prefix avoids Supabase's reserved `auth` and `storage`
-- schemas. App URLs then use `?schema=tw_<m>` and the user `tw_<m>_svc.<projectref>`.
--
-- Isolation: the schemas are owned by their role and no other role (nor PUBLIC) gets USAGE,
-- so a module cannot read another module's tables. Module roles own their tables, so Row
-- Level Security does not apply to them; it only blocks `anon` and `authenticated`.
-- Nothing here touches `public`, `auth`, `storage`, `extensions` or Supabase's own roles.

-- psql variables are not visible inside DO blocks, so the passwords travel as settings of
-- this session only.
-- `\gset` discards the result, so the passwords are not echoed.
SELECT set_config('tw.auth_pass', :'auth_pass', false) AS c1,
       set_config('tw.organization_pass', :'organization_pass', false) AS c2,
       set_config('tw.tasks_pass', :'tasks_pass', false) AS c3,
       set_config('tw.notifications_pass', :'notifications_pass', false) AS c4,
       set_config('tw.billing_pass', :'billing_pass', false) AS c5,
       set_config('tw.attendance_pass', :'attendance_pass', false) AS c6
\gset

DO $$
DECLARE
  m text;
  r text;
  s text;
  pass text;
BEGIN
  FOREACH m IN ARRAY ARRAY['auth', 'organization', 'tasks', 'notifications', 'billing', 'attendance']
  LOOP
    r := 'tw_' || m || '_svc';
    s := 'tw_' || m;
    pass := current_setting('tw.' || m || '_pass');

    IF pass IS NULL OR pass = '' THEN
      RAISE EXCEPTION 'missing password for %', m;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', r, pass);
    ELSE
      EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', r, pass);
    END IF;

    -- `postgres` is not a superuser on Supabase: it must be a member of the role to create a
    -- schema owned by it (and to manage it afterwards).
    EXECUTE format('GRANT %I TO postgres', r);

    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', s, r);
    EXECUTE format('ALTER ROLE %I SET search_path = %I', r, s);

    -- Our schemas only: no one but the owner can use them.
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', s);
  END LOOP;
END
$$;

-- Forget the passwords held in the session settings.
RESET tw.auth_pass;
RESET tw.organization_pass;
RESET tw.tasks_pass;
RESET tw.notifications_pass;
RESET tw.billing_pass;
RESET tw.attendance_pass;
