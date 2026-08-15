import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Fail at boot rather than on the first request that needs the value. A deploy that
// starts and then 500s on every call is harder to diagnose than one that never starts.
const REQUIRED_ENV = ['DATABASE_URL'] as const;

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

async function bootstrap(): Promise<void> {
  assertEnv();

  const app = await NestFactory.create(AppModule);

  // Comma-separated so local, production and Vercel preview origins can coexist
  // without a wildcard. The browser sends a bearer token, not a cookie, so
  // credentials stay off.
  const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${port}`);
}

void bootstrap();
