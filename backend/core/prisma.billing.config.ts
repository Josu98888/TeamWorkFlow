import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// One Prisma config per module schema (the schema, migrations and generated
// client live in `src/<module>/prisma/`). `prisma generate` runs in the Docker
// build, where BILLING_DATABASE_URL does not exist, so the URL is read
// without `env()` (which throws when it is unset).
export default defineConfig({
  schema: 'src/billing/prisma/schema.prisma',
  migrations: { path: 'src/billing/prisma/migrations' },
  datasource: { url: process.env.BILLING_DATABASE_URL ?? '' },
});
