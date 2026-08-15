import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AuthUser } from './auth/current-user.decorator';
import { FilesService } from './files/files.service';
import { NodesService } from './nodes/nodes.service';
import { PrismaService } from './prisma/prisma.service';
import { RoomsService } from './rooms/rooms.service';
import {
  ROOMS,
  SHARED_FOLDER,
  type SeedFile,
  type SeedFolder,
} from './seed/content';
import { buildPdf } from './seed/pdf';
import { SharesService } from './shares/shares.service';
import { StorageService } from './storage/storage.service';

/**
 * The demo account and its data room.
 *
 * Two things shape this script. The first is that it writes through the same services the
 * browser drives — `RoomsService`, `NodesService`, `FilesService`, `SharesService`, resolved
 * out of a Nest application context rather than reached over HTTP. Writing the rows directly
 * would be a third way of building the tree next to `NodesRepository` and the upload path,
 * and it would skip the `Range` probe that proves the bytes actually landed. A seed that
 * succeeds here is evidence that upload works, not just that Postgres accepted some rows.
 *
 * The second is that it is destructive, and there are real accounts in the same database. So
 * every delete is scoped by the demo user's `owner_id`, resolved from `DEMO_EMAIL`, and the
 * script refuses to start if that variable is missing rather than falling back to a default
 * that would widen the scope.
 *
 * Run it with `pnpm --filter api seed`.
 */

const logger = new Logger('Seed');

async function main(): Promise<void> {
  const email = required('DEMO_EMAIL').trim().toLowerCase();
  const password = required('DEMO_PASSWORD');
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');

  const userId = await resolveAuthUser(
    supabaseUrl,
    serviceKey,
    email,
    password,
  );
  const user: AuthUser = { id: userId, email };
  logger.log(`Demo account ${email} is ${userId}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const prisma = app.get(PrismaService);
    const storage = app.get(StorageService);
    const rooms = app.get(RoomsService);
    const nodes = app.get(NodesService);
    const files = app.get(FilesService);
    const shares = app.get(SharesService);

    // The `AuthGuard` writes this mirror row on a user's first request. The seed runs
    // before any request has been made, so it writes it here — every room, node and share
    // below carries a foreign key to it.
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email, name: 'Demo Reviewer', avatarUrl: null },
      update: { email, name: 'Demo Reviewer' },
    });

    await reset(prisma, storage, userId);

    let sharedFolderId: string | null = null;

    for (const room of ROOMS) {
      const created = await rooms.create(room.name, user);
      logger.log(`Created room "${room.name}"`);

      for (const folder of room.folders) {
        const folderId = await writeFolder(
          { nodes, files, user },
          created.rootNodeId,
          folder,
        );
        if (
          room.name === SHARED_FOLDER.room &&
          folder.name === SHARED_FOLDER.folder
        ) {
          sharedFolderId = folderId;
        }
      }
    }

    if (!sharedFolderId) {
      throw new Error(
        `No folder matched SHARED_FOLDER (${SHARED_FOLDER.room} / ${SHARED_FOLDER.folder}).`,
      );
    }

    const share = await shares.create(
      sharedFolderId,
      { kind: 'link', expiresIn: 'never' },
      user,
    );

    announce(share.token, email, password);
  } finally {
    // Closes the pg pool and clears the upload sweeper's timers; without it the process
    // hangs until they are collected.
    await app.close();
  }
}

/**
 * The Supabase auth user behind the demo credentials, created if it is not there yet.
 *
 * Signing in first is both the fast path and the definitive one: it proves the credentials
 * in the README actually work, which is the only property of this account that matters.
 * Creating covers a fresh project, and the third branch covers `DEMO_PASSWORD` having been
 * changed since the account was made — otherwise changing it would leave the seed failing
 * against a user it can neither sign into nor create.
 */
async function resolveAuthUser(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<string> {
  const auth = (path: string, init: RequestInit) =>
    fetch(`${supabaseUrl}/auth/v1${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

  const signIn = await auth('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (signIn.ok) {
    const body = (await signIn.json()) as { user?: { id?: string } };
    if (body.user?.id) return body.user.id;
  }

  const created = await auth('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (created.ok) {
    const body = (await created.json()) as { id?: string };
    if (body.id) return body.id;
  }

  const existing = await findAuthUserByEmail(auth, email);
  if (!existing) {
    throw new Error(
      `Could not sign in as ${email}, create it, or find it: ${await body(created)}`,
    );
  }

  logger.warn(`Resetting the password of ${email} to DEMO_PASSWORD`);
  const updated = await auth(`/admin/users/${existing}`, {
    method: 'PUT',
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!updated.ok) {
    throw new Error(
      `Could not reset the demo password: ${await body(updated)}`,
    );
  }
  return existing;
}

/** Paged rather than filtered: the admin list's filter syntax has moved between GoTrue
 *  versions, and a demo project holds a handful of users. */
async function findAuthUserByEmail(
  auth: (path: string, init: RequestInit) => Promise<Response>,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const response = await auth(`/admin/users?page=${page}&per_page=200`, {
      method: 'GET',
    });
    if (!response.ok) return null;

    const { users } = (await response.json()) as {
      users?: { id: string; email?: string }[];
    };
    if (!users || users.length === 0) return null;

    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
  }
  return null;
}

/**
 * Everything this account owns, removed so the seed can be run again without stacking a
 * second copy of the tree on top of the first.
 *
 * The order is forced by the schema. `data_rooms.root_node_id` and `nodes.parent_id` point
 * back into the rows being deleted, and `nodes.parent_id` is `onDelete: NoAction`, so the
 * pointers are broken first and the nodes then go deepest-first — a parent cannot be removed
 * while a child still names it.
 *
 * Every statement is filtered to rooms owned by this one user. Nothing here is capable of
 * reaching another account's data, which is the property that makes it safe to run against
 * the production database.
 */
async function reset(
  prisma: PrismaService,
  storage: StorageService,
  ownerId: string,
): Promise<void> {
  const rooms = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM data_rooms WHERE owner_id = ${ownerId}::uuid
  `;
  if (rooms.length === 0) {
    logger.log('No existing demo data to clear');
    return;
  }

  const ids = rooms.map((room) => room.id);
  logger.log(
    `Clearing ${rooms.length} existing demo room(s): ${rooms.map((room) => room.name).join(', ')}`,
  );

  // Objects first, while the rows that carry their keys still exist. This is the cleanup
  // that README.md records as deliberately not built for user-facing deletes; for data the
  // seed itself wrote, leaving the bytes behind on every re-run is just a leak.
  const objects = await prisma.$queryRaw<{ storageKey: string }[]>`
    SELECT v.storage_key AS "storageKey"
    FROM file_versions v
    JOIN nodes n ON n.id = v.node_id
    WHERE n.data_room_id = ANY(${ids}::uuid[])
  `;
  for (const object of objects) await storage.remove(object.storageKey);

  await prisma.$executeRaw`
    UPDATE data_rooms SET root_node_id = NULL WHERE owner_id = ${ownerId}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM shares
    WHERE node_id IN (SELECT id FROM nodes WHERE data_room_id = ANY(${ids}::uuid[]))
  `;
  await prisma.$executeRaw`
    UPDATE nodes SET current_version_id = NULL WHERE data_room_id = ANY(${ids}::uuid[])
  `;
  await prisma.$executeRaw`
    DELETE FROM file_versions
    WHERE node_id IN (SELECT id FROM nodes WHERE data_room_id = ANY(${ids}::uuid[]))
  `;

  const depth = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT max(depth) AS max FROM nodes WHERE data_room_id = ANY(${ids}::uuid[])
  `;
  for (let level = depth[0]?.max ?? 0; level >= 0; level--) {
    await prisma.$executeRaw`
      DELETE FROM nodes
      WHERE data_room_id = ANY(${ids}::uuid[]) AND depth = ${level}::int
    `;
  }

  await prisma.$executeRaw`
    DELETE FROM data_rooms WHERE owner_id = ${ownerId}::uuid
  `;
  logger.log(`Removed ${objects.length} stored object(s) and their rows`);
}

interface Writer {
  nodes: NodesService;
  files: FilesService;
  user: AuthUser;
}

async function writeFolder(
  writer: Writer,
  parentId: string,
  folder: SeedFolder,
): Promise<string> {
  const created = await writer.nodes.createFolder(
    parentId,
    folder.name,
    writer.user,
  );

  for (const file of folder.files ?? [])
    await writeFile(writer, created.id, file);
  for (const child of folder.folders ?? []) {
    await writeFolder(writer, created.id, child);
  }

  return created.id;
}

/** The two-phase upload, exactly as the browser performs it: reserve the name and take a
 *  signed URL, `PUT` the bytes straight to storage, then have the API read them back. */
async function writeFile(
  writer: Writer,
  parentId: string,
  file: SeedFile,
): Promise<void> {
  const bytes = buildPdf(file.document);

  const upload = await writer.files.init(
    { parentId, name: file.name, sizeBytes: bytes.length },
    writer.user,
  );

  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    // The API refuses an object stored under any other content type — see
    // `rejectionFor` in files.service.ts.
    headers: { 'Content-Type': 'application/pdf' },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) {
    throw new Error(
      `Storage refused ${file.name} (${response.status}): ${await body(response)}`,
    );
  }

  await writer.files.complete(upload.nodeId, upload.versionId, writer.user);
  logger.log(`Uploaded ${file.name} (${bytes.length} bytes)`);
}

/**
 * The plaintext token exists once, in the response that created it — only its SHA-256 hash
 * reaches the database, so nothing can show it again. It is printed here because the
 * alternative is a share link nobody can use.
 *
 * Written straight to stdout rather than through the logger: this block is meant to be
 * copied into README.md, and a timestamp and a level prefix on every line make that worse.
 */
function announce(token: string, email: string, password: string): void {
  const origin = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');

  process.stdout.write(
    [
      '',
      '  Demo account',
      `    Email     ${email}`,
      `    Password  ${password}`,
      '',
      '  Public share link (Project Atlas / 02 Financial)',
      `    /s/${token}`,
      // The path on its own as well as against the origin, because the seed is normally
      // run from a machine whose FRONTEND_ORIGIN is localhost while the database it is
      // writing to is the deployed one.
      `    against FRONTEND_ORIGIN: ${origin}/s/${token}`,
      '',
      '  This link is shown once. Re-running the seed mints a new one.',
      '',
      '',
    ].join('\n'),
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The seed deletes data scoped to it, so it has no default.`,
    );
  }
  return value;
}

async function body(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '<no body>';
  }
}

main().catch((error: Error) => {
  logger.error(error.message);
  process.exitCode = 1;
});
