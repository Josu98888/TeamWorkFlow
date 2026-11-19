-- Reference data: the plan catalog. Every subscription references plans(code)
-- (subscriptions_plan_fkey), so without these rows the trial created on
-- auth.tenant_created fails with a foreign key violation (P2003).
-- Values mirror INITIAL_PLANS in src/billing/prisma/seed-plans.ts.
-- ON CONFLICT DO NOTHING keeps prices or features already edited through
-- billing.admin.plan.update, and makes the migration safe where plans exist.
INSERT INTO "plans" ("code", "name", "monthly_price", "features", "is_active", "updated_at")
VALUES
  ('BASIC', 'Plan Básico', 50000, '{"tasks": false, "alerts": false, "tower": false}'::jsonb, true, CURRENT_TIMESTAMP),
  ('PRO', 'Plan Profesional', 100000, '{"tasks": true, "alerts": true, "tower": true}'::jsonb, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
