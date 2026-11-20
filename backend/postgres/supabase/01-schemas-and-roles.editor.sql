-- SQL Editor variant of 01-schemas-and-roles.sql (keep both in sync: same statements, different
-- way to pass the passwords). Use it when you cannot or do not want to run psql.
--
-- 1. Copy this file into a LOCAL, UNTRACKED place (or just the Supabase SQL Editor) and replace the six
--    'CHANGE_ME_*' placeholders below with six different strong passwords (one per module role).
--    Use passwords without quotes; prefer letters and digits so the connection URLs need no encoding.
-- 2. Paste it into the Supabase SQL Editor (it runs as `postgres`) and run it once. It is idempotent:
--    running it again keeps roles and schemas and resets their passwords.
-- 3. Delete the saved snippet from the SQL Editor afterwards (it stores the passwords in plain text).
--
-- NEVER COMMIT THE EDITED COPY. Only this placeholder version is tracked.
--
-- Creates, per module <m> in (auth, organization, tasks, notifications, billing, attendance): role
-- tw_<m>_svc (LOGIN, no superuser) and schema tw_<m> owned by it, with search_path = tw_<m>. See the
-- header of 01-schemas-and-roles.sql for the isolation notes.

DO $$
DECLARE
  m text;
  r text;
  s text;
  pass text;
  passwords jsonb := jsonb_build_object(
    'auth', 'CHANGE_ME_AUTH',
    'organization', 'CHANGE_ME_ORGANIZATION',
    'tasks', 'CHANGE_ME_TASKS',
    'notifications', 'CHANGE_ME_NOTIFICATIONS',
    'billing', 'CHANGE_ME_BILLING',
    'attendance', 'CHANGE_ME_ATTENDANCE'
  );
BEGIN
  FOREACH m IN ARRAY ARRAY['auth', 'organization', 'tasks', 'notifications', 'billing', 'attendance']
  LOOP
    r := 'tw_' || m || '_svc';
    s := 'tw_' || m;
    pass := passwords ->> m;

    IF pass IS NULL OR pass = '' OR pass LIKE 'CHANGE\_ME%' THEN
      RAISE EXCEPTION 'missing password for % (replace the CHANGE_ME placeholder)', m;
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
