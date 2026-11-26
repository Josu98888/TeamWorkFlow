-- CreateEnum
CREATE TYPE "pay_rate_type" AS ENUM ('HOURLY', 'PER_SHIFT');

-- CreateEnum
CREATE TYPE "payroll_run_status" AS ENUM ('DRAFT', 'CLOSED');

-- AlterEnum
ALTER TYPE "workday_status" ADD VALUE 'ABSENT';

-- AlterTable
ALTER TABLE "shift_snapshots" ADD COLUMN     "authorized_overtime_minutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "workdays" ADD COLUMN     "authorized_overtime_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "first_in_at" TIMESTAMPTZ(6),
ADD COLUMN     "has_out_of_geofence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_out_at" TIMESTAMPTZ(6),
ADD COLUMN     "post_id" UUID,
ADD COLUMN     "raw_overtime_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduled_minutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "site_snapshots" (
    "site_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_snapshots_pkey" PRIMARY KEY ("site_id")
);

-- CreateTable
CREATE TABLE "post_snapshots" (
    "post_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_snapshots_pkey" PRIMARY KEY ("post_id")
);

-- CreateTable
CREATE TABLE "employee_snapshots" (
    "employee_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_snapshots_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "employee_compensations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "pay_type" "pay_rate_type" NOT NULL,
    "base_rate" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_compensations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_compensations_base_rate_check" CHECK ("base_rate" >= 0)
);

-- CreateTable
CREATE TABLE "post_overtime_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "overtime_hourly_rate" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_overtime_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "post_overtime_rates_hourly_rate_check" CHECK ("overtime_hourly_rate" >= 0)
);

-- CreateTable
CREATE TABLE "compensation_change_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensation_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_id" UUID,
    "receive_daily" BOOLEAN NOT NULL DEFAULT true,
    "receive_monthly" BOOLEAN NOT NULL DEFAULT true,
    "receive_payroll_excel" BOOLEAN NOT NULL DEFAULT false,
    "assigned_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_attendance_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_date" TEXT NOT NULL,
    "site_id" UUID,
    "total_assigned_shifts" INTEGER NOT NULL DEFAULT 0,
    "attended_shifts" INTEGER NOT NULL DEFAULT 0,
    "absent_count" INTEGER NOT NULL DEFAULT 0,
    "out_of_geofence_count" INTEGER NOT NULL DEFAULT 0,
    "missing_clock_out_count" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_attendance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_attendance_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "site_id" UUID,
    "employees_count" INTEGER NOT NULL DEFAULT 0,
    "total_attended_shifts" INTEGER NOT NULL DEFAULT 0,
    "total_absent_shifts" INTEGER NOT NULL DEFAULT 0,
    "total_out_of_geofence" INTEGER NOT NULL DEFAULT 0,
    "total_missing_clock_outs" INTEGER NOT NULL DEFAULT 0,
    "total_worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "total_overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_attendance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_payroll_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "site_id" UUID,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "total_regular_pay" DECIMAL(14,2) NOT NULL,
    "total_overtime_pay" DECIMAL(14,2) NOT NULL,
    "total_pay" DECIMAL(14,2) NOT NULL,
    "warnings_count" INTEGER NOT NULL DEFAULT 0,
    "generated_by_user_id" UUID NOT NULL,
    "status" "payroll_run_status" NOT NULL DEFAULT 'CLOSED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_payroll_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "pay_type" "pay_rate_type",
    "base_rate_applied" DECIMAL(12,2),
    "assigned_shifts" INTEGER NOT NULL DEFAULT 0,
    "attended_shifts" INTEGER NOT NULL DEFAULT 0,
    "absent_shifts" INTEGER NOT NULL DEFAULT 0,
    "missing_clock_out_shifts" INTEGER NOT NULL DEFAULT 0,
    "fraudulent_clock_ins" INTEGER NOT NULL DEFAULT 0,
    "regular_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "regular_pay" DECIMAL(12,2) NOT NULL,
    "overtime_pay" DECIMAL(12,2) NOT NULL,
    "total_pay" DECIMAL(12,2) NOT NULL,
    "observations" TEXT,

    CONSTRAINT "monthly_payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_site_snapshot_tenant" ON "site_snapshots"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_post_snapshot_tenant_site" ON "post_snapshots"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "idx_employee_snapshot_tenant" ON "employee_snapshots"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employee_snapshot_tenant_user" ON "employee_snapshots"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_employee_compensation_tenant_emp" ON "employee_compensations"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_post_overtime_rate_tenant_post" ON "post_overtime_rates"("tenant_id", "post_id");

-- CreateIndex
CREATE INDEX "idx_compensation_change_log_tenant" ON "compensation_change_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_report_recipient_tenant_user" ON "report_recipients"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_daily_report_tenant_date" ON "daily_attendance_reports"("tenant_id", "report_date");

-- CreateIndex
CREATE INDEX "idx_monthly_report_tenant_period" ON "monthly_attendance_reports"("tenant_id", "period");

-- CreateIndex
CREATE INDEX "idx_payroll_run_tenant_period" ON "monthly_payroll_runs"("tenant_id", "period");

-- CreateIndex
CREATE INDEX "idx_payroll_line_tenant_run" ON "monthly_payroll_lines"("tenant_id", "run_id");

-- CreateIndex
CREATE INDEX "idx_shift_snapshot_tenant_starts" ON "shift_snapshots"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "idx_workday_tenant_status" ON "workdays"("tenant_id", "status", "updated_at");

-- AddForeignKey
ALTER TABLE "monthly_payroll_lines" ADD CONSTRAINT "monthly_payroll_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "monthly_payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
