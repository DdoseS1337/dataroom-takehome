import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Fail at boot rather than on the first request that needs the value. A deploy that
// starts and then 500s on every call is harder to diagnose than one that never starts.
//
// FRONTEND_ORIGIN is required rather than defaulted: a silent fallback to localhost
// boots green, passes the health check, and locks every browser out of the deployed
// API — a failure that only shows up as an unexplained CORS error in the client.
const REQUIRED_ENV = ['DATABASE_URL', 'FRONTEND_ORIGIN'] as const;

function assertEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  if (!process.env.SUPABASE_JWKS_URL && !process.env.SUPABASE_JWT_SECRET) {
    throw new Error(
      'Missing JWT verification config: set SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET.',
    );
  }
}

// Comma-separated so local, production and Vercel preview origins can coexist without
// a wildcard. Trailing slashes are stripped because an `Origin` header never carries
// one, and pasting a browser URL into the variable is the obvious way to get this wrong.
function parseOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('FRONTEND_ORIGIN is set but contains no usable origin.');
  }
  return origins;
}

async function bootstrap(): Promise<void> {
  assertEnv();

  const app = await NestFactory.create(AppModule);

  // Without this, onModuleDestroy never runs and the database pool is torn down by
  // process death on every redeploy.
  app.enableShutdownHooks();

  const origins = parseOrigins(process.env.FRONTEND_ORIGIN!);

  // The browser sends a bearer token, not a cookie, so credentials stay off.
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on :${port}`);
  logger.log(`Allowed origins: ${origins.join(', ')}`);
}

void bootstrap();
