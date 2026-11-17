-- Dedup rows written before this column existed cannot be attributed to a tenant.
-- Every insert into this table failed until now (the processor already wrote
-- tenant_id), so it holds no rows in practice; deleting any orphan row keeps
-- the NOT NULL column safe. Handlers are also idempotent by natural key, so a
-- redelivered event is harmless.
DELETE FROM "processed_events";

-- AlterTable
ALTER TABLE "processed_events" ADD COLUMN "tenant_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "processed_events_tenant_id_idx" ON "processed_events"("tenant_id");
