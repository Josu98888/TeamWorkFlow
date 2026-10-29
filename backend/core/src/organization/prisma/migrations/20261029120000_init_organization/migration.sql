-- CreateEnum
CREATE TYPE "shift_status" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geofence_radius_meters" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "qr_code" TEXT NOT NULL,
    "qr_rotated_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "required_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_people" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_media_id" UUID,
    "employee_number" TEXT,
    "national_id" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weekly_hours_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_sites" (
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,

    CONSTRAINT "employee_sites_pkey" PRIMARY KEY ("employee_id","site_id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID,
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "employee_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "shift_status" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "starting_emitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_states" (
    "tenant_id" UUID NOT NULL,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_states_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_qr_code_key" ON "sites"("qr_code");

-- CreateIndex
CREATE INDEX "sites_tenant_id_is_active_idx" ON "sites"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "posts_tenant_id_site_id_idx" ON "posts"("tenant_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_email_key" ON "employees"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_user_id_key" ON "employees"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_number_key" ON "employees"("tenant_id", "employee_number");

-- CreateIndex
CREATE INDEX "employee_sites_tenant_id_site_id_idx" ON "employee_sites"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_employee_id_starts_at_idx" ON "shifts"("tenant_id", "employee_id", "starts_at");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_site_id_starts_at_idx" ON "shifts"("tenant_id", "site_id", "starts_at");

-- CreateIndex
CREATE INDEX "shifts_status_starts_at_idx" ON "shifts"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_template_id_starts_at_key" ON "shifts"("tenant_id", "template_id", "starts_at");

-- CreateIndex
CREATE INDEX "processed_events_tenant_id_idx" ON "processed_events"("tenant_id");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_sites" ADD CONSTRAINT "employee_sites_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_sites" ADD CONSTRAINT "employee_sites_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
