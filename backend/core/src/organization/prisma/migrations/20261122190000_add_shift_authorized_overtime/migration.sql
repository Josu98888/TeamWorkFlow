-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "authorized_overtime_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtime_assigned_at" TIMESTAMPTZ(3),
ADD COLUMN     "overtime_assigned_by_user_id" UUID,
ADD COLUMN     "overtime_reason" TEXT;

-- Enforce non-negative authorized overtime minutes (0 .. 720).
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_authorized_overtime_minutes_check" CHECK ("authorized_overtime_minutes" >= 0 AND "authorized_overtime_minutes" <= 720);
