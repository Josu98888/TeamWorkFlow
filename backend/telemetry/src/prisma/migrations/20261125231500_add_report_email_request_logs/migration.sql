-- CreateEnum
CREATE TYPE "report_email_kind" AS ENUM ('DAILY_ABSENCES_PDF', 'MONTHLY_ATTENDANCE_PDF', 'MONTHLY_PAYROLL_EXCEL');

-- CreateEnum
CREATE TYPE "report_email_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "employee_snapshots" ADD COLUMN     "site_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "report_recipients" ADD COLUMN     "site_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "report_email_request_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "report_kind" "report_email_kind" NOT NULL,
    "request_date" TEXT NOT NULL,
    "target_period" TEXT NOT NULL,
    "status" "report_email_status" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_email_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_report_email_req_tenant_site_date" ON "report_email_request_logs"("tenant_id", "site_id", "request_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_report_email_req_daily_limit" ON "report_email_request_logs"("tenant_id", "user_id", "site_id", "report_kind", "request_date");
