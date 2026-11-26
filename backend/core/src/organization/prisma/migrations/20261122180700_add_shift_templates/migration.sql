-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "employee_id" UUID,
    "weekdays" INTEGER[],
    "start_time" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_templates_tenant_id_site_id_post_id_is_active_idx" ON "shift_templates"("tenant_id", "site_id", "post_id", "is_active");

-- CreateIndex
CREATE INDEX "shift_templates_tenant_id_employee_id_idx" ON "shift_templates"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "shift_templates_is_active_tenant_id_idx" ON "shift_templates"("is_active", "tenant_id");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce shift duration bounds (1 minute .. 24 hours).
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_duration_minutes_check" CHECK ("duration_minutes" > 0 AND "duration_minutes" <= 1440);
