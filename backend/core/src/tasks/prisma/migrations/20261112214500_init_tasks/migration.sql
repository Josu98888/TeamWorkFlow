-- CreateEnum
CREATE TYPE "deadline_mode" AS ENUM ('AFTER_START', 'AT_SHIFT_END');

-- CreateEnum
CREATE TYPE "task_kind" AS ENUM ('SINGLE', 'PER_SHIFT');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('PENDING', 'UPLOADED');

-- CreateEnum
CREATE TYPE "review_result" AS ENUM ('NONE', 'APPROVED', 'OBSERVED');

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "draft_fields" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID NOT NULL,

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "deadline_mode" "deadline_mode" NOT NULL,
    "deadline_minutes" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "task_kind" NOT NULL,
    "status" "task_status" NOT NULL DEFAULT 'PENDING',
    "form_version_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "employee_id" UUID,
    "claimed_at" TIMESTAMPTZ(3),
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "shift_id" UUID,
    "template_id" UUID,
    "expected_qr" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_answers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "client_answer_id" TEXT NOT NULL,
    "device_time" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by_user_id" UUID NOT NULL,
    "review_result" "review_result" NOT NULL DEFAULT 'NONE',
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "status" "media_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_state" (
    "tenant_id" UUID NOT NULL,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_state_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_features" (
    "tenant_id" UUID NOT NULL,
    "features" JSONB NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" TEXT NOT NULL,
    "tenant_id" UUID,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "forms_tenant_id_created_at_idx" ON "forms"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "form_versions_tenant_id_form_id_idx" ON "form_versions"("tenant_id", "form_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_versions_form_id_version_key" ON "form_versions"("form_id", "version");

-- CreateIndex
CREATE INDEX "task_templates_tenant_id_site_id_post_id_idx" ON "task_templates"("tenant_id", "site_id", "post_id");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_employee_id_status_idx" ON "tasks"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_site_id_status_idx" ON "tasks"("tenant_id", "site_id", "status");

-- CreateIndex
CREATE INDEX "tasks_status_deadline_idx" ON "tasks"("status", "deadline");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_shift_id_template_id_idx" ON "tasks"("tenant_id", "shift_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_tenant_id_shift_id_template_id_unique" ON "tasks"("tenant_id", "shift_id", "template_id") WHERE "shift_id" IS NOT NULL AND "template_id" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "task_answers_task_id_key" ON "task_answers"("task_id");

-- CreateIndex
CREATE INDEX "task_answers_tenant_id_submitted_by_user_id_idx" ON "task_answers"("tenant_id", "submitted_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_answers_tenant_id_client_answer_id_key" ON "task_answers"("tenant_id", "client_answer_id");

-- CreateIndex
CREATE INDEX "media_tenant_id_created_at_idx" ON "media"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "media_tenant_id_uploaded_by_user_id_idx" ON "media"("tenant_id", "uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "processed_events_tenant_id_idx" ON "processed_events"("tenant_id");

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "task_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_answers" ADD CONSTRAINT "task_answers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_answers" ADD CONSTRAINT "task_answers_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
