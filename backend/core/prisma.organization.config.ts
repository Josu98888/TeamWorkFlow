import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// One Prisma config per module schema (the schema, migrations and generated
// client live in `src/<module>/prisma/`). `prisma generate` runs in the Docker
// build, where ORGANIZATION_DATABASE_URL does not exist, so the URL is read
// without `env()` (which throws when it is unset).
export default defineConfig({
  schema: 'src/organization/prisma/schema.prisma',
  migrations: { path: 'src/organization/prisma/migrations' },
  datasource: {
    // Migrations may need a session or direct connection (for example
    // Supabase) while the app uses a pooled one.
    url:
      process.env.MIGRATE_ORGANIZATION_DATABASE_URL ??
      process.env.ORGANIZATION_DATABASE_URL ??
      '',
  },
});
