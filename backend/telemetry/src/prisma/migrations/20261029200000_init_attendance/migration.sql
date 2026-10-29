-- CreateEnum
CREATE TYPE "clock_event_type" AS ENUM ('IN', 'OUT', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "clock_event_method" AS ENUM ('GPS', 'QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "workday_status" AS ENUM ('OPEN', 'CLOSED', 'MISSING_CLOCK_OUT');

-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('LATE', 'UNCOVERED_POST', 'OUT_OF_GEOFENCE', 'MISSING_CLOCK_OUT');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "shift_status" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shift_snapshots" (
    "shift_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "employee_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "shift_status" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "shift_snapshots_pkey" PRIMARY KEY ("shift_id")
);

-- CreateTable
CREATE TABLE "clock_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "type" "clock_event_type" NOT NULL,
    "method" "clock_event_method" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distance_meters" DOUBLE PRECISION,
    "out_of_geofence" BOOLEAN NOT NULL DEFAULT false,
    "client_event_id" TEXT NOT NULL,
    "device_time" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "reason" TEXT,

    CONSTRAINT "clock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clock_event_corrections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "clock_event_id" UUID NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "corrected_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_event_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workdays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "workday_status" NOT NULL DEFAULT 'OPEN',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "alert_type" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'OPEN',
    "site_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "employee_id" UUID,
    "clock_event_id" UUID,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_states" (
    "tenant_id" UUID NOT NULL,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_states_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_features" (
    "tenant_id" UUID NOT NULL,
    "features" JSONB NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" TEXT NOT NULL,
    "tenant_id" UUID,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "idx_shift_snapshot_tenant_site" ON "shift_snapshots"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "idx_shift_snapshot_status_starts_at" ON "shift_snapshots"("status", "starts_at");

-- CreateIndex
CREATE INDEX "idx_clock_event_lookup" ON "clock_events"("tenant_id", "shift_id", "device_time");

-- CreateIndex
CREATE INDEX "idx_clock_event_employee" ON "clock_events"("tenant_id", "employee_id", "device_time");

-- CreateIndex
CREATE UNIQUE INDEX "uq_clock_event_tenant_client_event" ON "clock_events"("tenant_id", "client_event_id");

-- CreateIndex
CREATE INDEX "idx_clock_correction_event" ON "clock_event_corrections"("tenant_id", "clock_event_id");

-- CreateIndex
CREATE INDEX "idx_workday_employee_status" ON "workdays"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workday_tenant_shift" ON "workdays"("tenant_id", "shift_id");

-- CreateIndex
CREATE INDEX "idx_alert_tenant_site_status" ON "alerts"("tenant_id", "site_id", "status");

-- CreateIndex
CREATE INDEX "idx_alert_shift_lookup" ON "alerts"("tenant_id", "shift_id", "type");

-- CreateIndex
CREATE INDEX "idx_processed_event_tenant" ON "processed_events"("tenant_id");

-- AddForeignKey
ALTER TABLE "clock_event_corrections" ADD CONSTRAINT "clock_event_corrections_clock_event_id_fkey" FOREIGN KEY ("clock_event_id") REFERENCES "clock_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_clock_event_id_fkey" FOREIGN KEY ("clock_event_id") REFERENCES "clock_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

