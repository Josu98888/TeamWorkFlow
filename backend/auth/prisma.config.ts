import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` runs in the Docker build, where DATABASE_URL does not
// exist, so the URL is read without `env()` (which throws when it is unset).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
