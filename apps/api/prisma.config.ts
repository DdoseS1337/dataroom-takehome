import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// This file configures the Prisma CLI only. In Prisma 7 the running app connects
// through a driver adapter (see src/prisma/prisma.service.ts) and never reads this,
// so the CLI gets DIRECT_URL — the session-mode connection on port 5432. Migrations
// take an advisory lock, which pgBouncer in transaction mode on 6543 cannot hold.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
