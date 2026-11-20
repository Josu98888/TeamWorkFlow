import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'src/prisma/schema.prisma',
  migrations: { path: 'src/prisma/migrations' },
  datasource: {
    // Migrations may need a session or direct connection (for example
    // Supabase) while the app uses a pooled one.
    url:
      process.env.MIGRATE_ATTENDANCE_DATABASE_URL ??
      process.env.ATTENDANCE_DATABASE_URL ??
      '',
  },
});
