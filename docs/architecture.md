# Architecture

Backend, API, auth, uploads, sharing. Read before touching anything in `apps/api`.

## Shape

```
Browser ── auth (login only) ──────────────► Supabase Auth
   │
   ├── all data + authorisation ───────────► NestJS API ──► Postgres
   │
   └── file bytes (via signed URL) ────────► Supabase Storage
                                                  ▲
                                        signed URLs minted here
```

**Authorisation lives only in the API.** RLS is enabled with deny-all policies as a backstop against accidental anon-key access — never as the access mechanism. Effective permission is the maximum grant across a node's entire ancestor chain, which is awkward and slow as a recursive RLS policy and would duplicate a rule that already exists in `resolvePermission()`. Two sources of truth for access control drift.

**File bytes never pass through the API.** Signed URLs with 60s TTL, minted only after a permission check.

**The API is a long-lived Node process, not serverless.** Nest builds its module graph on boot; a cold start per navigation is visible in the UI.

## Layering — deliberately flat

```
controller  →  service  →  NodesRepository / Prisma
```

Three layers. No use-case classes, no domain layer, no ports and adapters, no mappers between layers, no interface in front of Prisma beyond `NodesRepository`. If an imported skill recommends otherwise, see the precedence rule in `CLAUDE.md`.

`NodesRepository` exists for one reason: every query touching the tree needs `deleted_at IS NULL` and prefix-scan semantics, and that must live in one place. It is not a generic abstraction and should not grow into one.

## Invariants

Violating any of these is a bug even if tests pass.

- **Every read filters `deleted_at IS NULL`.** All tree queries go through `NodesRepository`. Do not scatter node queries across services.
- **Never `SELECT` to pre-check a name conflict.** That is a TOCTOU race under concurrent uploads. Catch Postgres `23505` from the unique index.
- **Permission is derived only by `resolvePermission()`.** Never inline, never re-derived in a controller or component.
- **Effective permission is the maximum grant across the whole ancestor chain**, not the first grant found walking up.
- **Unauthorised and nonexistent both return `404`.** A `403` confirms the resource exists.
- **Permission resolves before the tombstone check.** `resolvePermission()` runs against the node including soft-deleted ones. `none` → `404`; permitted but deleted → `410`. Checking `deleted_at` first is the natural thing to write and turns `410` into an existence oracle for anyone probing ids.
- **Never reveal a share grantee's email** to a requester who is not that grantee. Mismatch messages are built from the requester's own email.
- **`/s/:token` is `@Public()`.** The brief requires a public link to work without signing in.
- **Every mutation is authorised server-side.** Hiding a button is not authorisation.

## Auth

Supabase Auth issues the JWT; the browser holds only the anon key and uses it solely to sign in. Nest verifies the token and upserts a local `users` row on first request.

No foreign key to `auth.users` — that is a vendor-owned schema Prisma does not manage. The local `users.id` equals the Supabase `sub`.

## Upload is two-phase

Naively "upload the blob, then insert the row" fails two ways: an orphaned blob you keep paying for, or a row pointing at nothing.

1. `POST /files/init` — creates the node with `status='uploading'`. **The unique index covers `uploading` rows**, so a name conflict raises `23505` here, before any bytes move. Returns a signed upload URL.
2. Browser `PUT`s the file straight to storage.
3. `POST /files/:id/complete` — verifies the object exists, confirms the magic bytes, records size and checksum, flips `status='ready'`.

Listings return only `status='ready'`. A sweeper removes rows stuck in `uploading` for more than 15 minutes.

**An abandoned upload holds its name for 15 minutes.** That is the price of covering `uploading` rows in the unique index, and it is the cheaper side of the trade: excluding them would push the conflict to step 3, after the user has already uploaded the bytes, and would let two concurrent uploads of the same name both pass step 1. On `23505` against an `uploading` row older than 15 minutes, soft-delete that row and retry the insert once; anything else is `NAME_CONFLICT`. Without the retry, a closed tab blocks the name until the sweeper next runs.

**PDF validation is server-side.** The browser checks for `%PDF-` before starting the upload so the user gets an immediate error, but that check is advisory — the bytes go straight to storage and the API never sees them in flight. The authoritative check is a `Range: bytes=0-1023` read of the stored object during `/files/:id/complete`. A file carrying no PDF header is rejected there and the node never reaches `ready`. Never validate by extension.

**The header is searched for, not required at offset zero.** The spec tolerates leading bytes and every reader — pdf.js included — scans the first kilobyte. Demanding offset zero rejects real documents: a PDF wrapped in a PKCS#7 container, which is what a qualified electronic signature produces, carries its header around offset 70 and renders perfectly well. Both checks use the same rule so the browser never promises something the API then refuses.

## Sharing

One `shares` table serves both modes. Tokens are 256 bits of CSPRNG output; only the SHA-256 hash is stored, so a database dump yields no working links.

Response to `/s/:token` depends on what we already know about the requester:

| Requester | Response |
|---|---|
| Anonymous | "Sign in to view this item" — existence of the token is not confirmed |
| Signed in, email matches grantee | Content |
| Signed in, email does not match | Message built from **their own** email, plus a switch-account action |

Shares granted to an email with no account yet are stored as `grantee_email` and resolved on signup, so inviting an unregistered user works without depending on email delivery.

**Deleting a node does not touch its `shares` rows.** Combined with the ordering invariant above: a holder of a valid share on a deleted subtree gets `410` and an explanation, while a guessed token still gets `404`. Revocation is a separate, explicit act — `DELETE /shares/:id`.

`Referrer-Policy: no-referrer` on that route, and full URLs stay out of request logs — otherwise tokens leak through the `Referer` header and log aggregation.

## API contract — frozen

Changing response shapes after the frontend exists is the most expensive rework available. Raise a needed change before implementing it.

```
GET    /rooms
POST   /rooms
GET    /nodes/:id                 -> node + breadcrumbs[] + permission, one response
GET    /nodes/:id/children        -> keyset: ?cursor=&limit=50
GET    /nodes/:id/stats           -> { fileCount, folderCount, totalBytes }
POST   /folders
PATCH  /nodes/:id                 -> { name?, parentId?, onConflict? }
DELETE /nodes/:id
POST   /files/init                -> { uploadUrl, nodeId }
POST   /files/:id/complete
GET    /files/:id/download-url    -> { url, expiresAt }
GET    /nodes/:id/shares
POST   /nodes/:id/shares
DELETE /shares/:id
GET    /s/:token/...              -> public mirror of read endpoints
GET    /search?q=
```

`GET /nodes/:id` returns node, breadcrumbs, and permission together — three round trips per navigation makes the UI flicker.

Errors are always `{ code, message, details? }`:
`NAME_CONFLICT`, `NODE_GONE`, `CYCLE_DETECTED`, `FORBIDDEN`, `SHARE_EXPIRED`, `WRONG_ACCOUNT`.
The frontend branches on `code`, never on message text.

## Testing

Tests go where a bug is a security incident, not spread for coverage. Write them inside the block that produces the code.

- `resolvePermission()` — table-driven: owner, public link, named grant, revoked, expired, inherited from ancestor, moved out of scope
- Name conflict resolution and cycle detection, including case-only rename and self-descendant move
- API security matrix via Supertest: non-owner gets 404, revoked token fails, viewer cannot mutate
- One Playwright happy path

No tests for DTO validation, getters, or framework behaviour. If a skill recommends full controller test coverage, see the precedence rule.
