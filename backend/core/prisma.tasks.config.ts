import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// One Prisma config per module schema (the schema, migrations and generated
// client live in `src/<module>/prisma/`). `prisma generate` runs in the Docker
// build, where TASKS_DATABASE_URL does not exist, so the URL is read
// without `env()` (which throws when it is unset).
export default defineConfig({
  schema: 'src/tasks/prisma/schema.prisma',
  migrations: { path: 'src/tasks/prisma/migrations' },
  datasource: { url: process.env.TASKS_DATABASE_URL ?? '' },
});
