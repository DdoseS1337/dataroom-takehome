# Data Room

A virtual data room for M&A due diligence: organise documents in nested folders, upload PDFs, and share a room, folder, or single file with read-only access — either via a public link or with named recipients.

**Live app:** https://dataroom-takehome-web.vercel.app
**API:** https://dataroom-takehome-production.up.railway.app/health
> **Build status: in progress.** What works today: Google sign-in, creating data rooms,
> creating nested folders, navigating them by breadcrumb, and uploading PDFs — drag and
> drop or file picker, with a queue that survives navigation, per-file progress, cancel,
> retry, and the name-conflict dialog. Also: reading a PDF in the app, downloading it,
> and renaming, moving and deleting items and whole data rooms. **Sharing, search and the
> demo account are not built yet.** Everything below describes the design being built
> toward; this note is removed, and the claim inverted, once the last block lands.

---

## Table of contents

- [Stack](#stack)
- [Running locally](#running-locally)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Key design decisions](#key-design-decisions)
- [Edge cases handled](#edge-cases-handled)
- [Security notes](#security-notes)
- [How it scales](#how-it-scales)
- [Testing](#testing)
- [Where I used AI](#where-i-used-ai)
- [Known limitations](#known-limitations)

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind, shadcn/ui | Matches the team's stack; App Router gives route-level loading/error boundaries for free |
| Backend | NestJS, Prisma | Same |
| Database | PostgreSQL (Supabase) | Managed Postgres, same vendor as auth and storage |
| Auth | Supabase Auth (Google OAuth + email/password) | Removes ~2h of password-reset and OAuth plumbing that adds no signal to this exercise |
| File storage | Supabase Storage (private bucket) | Signed URLs, no public objects |
| PDF rendering | `react-pdf` (pdf.js) | An `<iframe>` cannot report whether it rendered anything, so the required "Preview unavailable" state would be unreachable — and its behaviour on mobile Safari is not consistent. Its worker, CMaps, fonts and WASM decoders are copied out of the pinned `pdfjs-dist` at build time and served from `/pdf`, so no request leaves the app |
| Hosting | Frontend on Vercel, API on Railway | API runs as a long-lived Node process, not serverless — see [Architecture](#architecture) |

---

## Running locally

**Prerequisites:** Node 20+, pnpm, a Supabase project.

```bash
git clone <repo> && cd dataroom
pnpm install
```

### 1. Supabase setup

1. Create a project at supabase.com.
2. Create a **private** storage bucket named `dataroom-files`. Do not make it public — public objects cannot be revoked.
3. Under Authentication → Providers, enable Google and Email.
4. Under Authentication → Settings, disable "Confirm email" (or configure custom SMTP) so signup works without inbox round-trips.

### 2. Environment

`apps/api/.env`:

```env
# Pooled connection for the running app
DATABASE_URL="postgresql://...@...pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
# Direct connection — required for migrations
DIRECT_URL="postgresql://...@...supabase.com:5432/postgres"

SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."   # server only, never sent to the browser
SUPABASE_JWT_SECRET="..."         # or JWKS URL, depending on your project's key type
STORAGE_BUCKET="dataroom-files"
FRONTEND_ORIGIN="http://localhost:3000"
```

`apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

The service role key stays server-side. The browser only ever holds the anon key, and only uses it to sign in.

### 3. Database and seed

```bash
pnpm --filter api exec prisma migrate deploy
```

The seed script that creates the demo account and sample tree is not written yet.

### 4. Run

```bash
pnpm dev        # web on :3000, api on :3001
```

---

## Architecture

```
Browser ──── auth (login only) ────────────────► Supabase Auth
   │
   ├──── all data + authorisation ─────────────► NestJS API ──► Postgres
   │                                                  │
   └──── file bytes (via signed URL) ──────────► Supabase Storage
                                                      ▲
                                            signed URLs minted here
```

Three decisions worth explaining:

**Authorisation lives only in the API.** Row Level Security is enabled on every table with a deny-all policy, but purely as a backstop against accidental direct access with the anon key — not as the authorisation mechanism. Effective permission on a node is the maximum grant across its entire ancestor chain, which is awkward and slow to express as a recursive RLS policy, and would duplicate a rule that already exists in `resolvePermission()`. Two sources of truth for access control drift; one does not.

**File bytes never pass through the API.** Uploads and downloads go browser ↔ storage directly, using short-lived signed URLs minted by the API after a permission check. This keeps the API cheap and avoids request-size limits.

**The API is a long-lived process, not serverless.** Nest's module graph is built on boot — fine once, wasteful per-request. A cold start on every navigation is visible in the UI.

### Upload is two-phase

Naively "upload the blob, then insert the row" has two failure modes: an orphaned blob you keep paying for, or a database row pointing at nothing.

1. `POST /files/init` — creates the node with `status='uploading'`. **The unique index covers `uploading` rows**, so a name conflict raises `23505` here, before a single byte moves. Returns a signed upload URL.
2. Browser `PUT`s the file straight to storage.
3. `POST /files/:id/complete` — verifies the object exists, confirms the magic bytes, records size and checksum, flips `status='ready'`.

Listings only return `status='ready'`. Rows stuck in `uploading` for more than 15 minutes are swept by a scheduled job.

The trade-off in covering `uploading` rows is that an abandoned upload reserves its name for up to 15 minutes; a `23505` against an `uploading` row older than that is treated as abandoned — the row is soft-deleted and the insert retried once. Excluding those rows from the index instead would move the conflict to step 3, after the user has already transferred the bytes, and would let two concurrent uploads of the same name both pass step 1.

**PDF validation is server-side.** The browser checks for a `%PDF-` header before starting an upload so the user gets an immediate error, but the bytes go straight to storage and the API never sees them in flight — so the authoritative check is a `Range: bytes=0-1023` read of the stored object during `/files/:id/complete`. A file that fails it never reaches `ready`.

The header is searched for within that first kilobyte rather than demanded at offset zero, which is what the spec tolerates and what pdf.js does. It matters in practice: a PDF wrapped in a PKCS#7 container — the shape a qualified electronic signature takes — carries its header around offset 70, and renders perfectly well.

---

## Data model

```mermaid
erDiagram
  USERS ||--o{ DATA_ROOMS : owns
  DATA_ROOMS ||--o{ NODES : contains
  NODES ||--o{ NODES : "parent of"
  NODES ||--o{ FILE_VERSIONS : "has"
  NODES ||--o{ SHARES : "shared via"
  USERS ||--o{ SHARES : "granted to"

  USERS {
    uuid id PK
    string email UK
    string name
    string avatar_url
  }
  DATA_ROOMS {
    uuid id PK
    uuid owner_id FK
    string name
    uuid root_node_id FK
    timestamp deleted_at
  }
  NODES {
    uuid id PK
    uuid data_room_id FK
    uuid parent_id FK
    string type
    string name
    string path
    int depth
    smallint sort_rank
    uuid current_version_id FK
    string status
    timestamp deleted_at
  }
  FILE_VERSIONS {
    uuid id PK
    uuid node_id FK
    string storage_key
    bigint size_bytes
    string mime_type
    int version_no
  }
  SHARES {
    uuid id PK
    uuid node_id FK
    string kind
    string token_hash
    uuid grantee_user_id FK
    string grantee_email
    string role
    timestamp expires_at
    timestamp revoked_at
  }
```

### Tree representation

Folders and files live in a single `nodes` table. `parent_id` is the source of truth; `path` is a denormalised materialised path (`/rootId/folderId/nodeId/`) maintained inside the same transaction as any structural change.

| Approach | Subtree query | Move | Complexity |
|---|---|---|---|
| Adjacency list only | Recursive CTE — one index scan per level, cost scales with depth | Single row update | Lowest |
| **Materialised path (chosen)** | One prefix range scan, depth-independent | Rewrite prefix for K descendants | Medium |
| Closure table | Index scan on `ancestor_id`, fastest both directions | Rebuild K × D rows | Highest |

Materialised path was picked because the expensive query in this app is "aggregate everything under this folder", and a prefix range scan answers it in one pass regardless of depth. A closure table would only pull ahead on ancestor-direction and depth-bounded queries, neither of which this app issues, and it introduces a second structure that must stay transactionally consistent through every insert, move, and delete. It can be added later as a pure derivative of `parent_id` without touching any existing column — so deferring it costs nothing.

`path` is stored as `text` with a `text_pattern_ops` index rather than `ltree`, because Prisma has no native `ltree` support and every subtree query would fall back to untyped raw SQL. Depth is capped at 32.

### Indexes

Partial and expression indexes cannot be expressed in `schema.prisma`, so these are hand-written in the migration files:

```sql
ALTER TABLE nodes ADD COLUMN sort_rank smallint NOT NULL
  GENERATED ALWAYS AS (CASE WHEN type = 'folder' THEN 0 ELSE 1 END) STORED;

CREATE UNIQUE INDEX nodes_name_uniq ON nodes (parent_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX nodes_path_prefix ON nodes (path text_pattern_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX nodes_listing ON nodes (parent_id, sort_rank, lower(name), id)
  WHERE deleted_at IS NULL;
```

`nodes_name_uniq` deliberately does not filter on `status`, so the constraint fires at `/files/init` rather than after the bytes have moved.

`nodes_listing` column order matches the listing `ORDER BY` exactly: `sort_rank, lower(name), id`. The generated `sort_rank` column exists because folders must sort before files but `'file' < 'folder'` alphabetically — and the obvious repair, `ORDER BY type DESC, lower(name) ASC`, mixes directions, which an all-ascending btree cannot serve as an ordered scan and which breaks tuple-comparison keyset:

```sql
WHERE (sort_rank, lower(name), id) > (:rank, :name, :id)
```

All ascending, one index scan, one comparison per page.

**Why every data room has a real root node** rather than `parent_id IS NULL`: Postgres treats NULLs in a unique index as distinct, so two files named `report.pdf` at the top level would both pass the constraint. A materialised root makes the constraint uniform at every level.

---

## Key design decisions

### Name conflicts

The brief requires conflicts to be resolved but does not specify how, so the strategy is chosen for the domain. In a due-diligence data room, a silent automatic action is actively harmful: `MSA.pdf` and `MSA (1).pdf` sitting side by side means a lawyer may open the wrong document and nobody finds out.

| Situation | Behaviour |
|---|---|
| Upload / move | Dialog: **Keep both** (default) / **Replace** / **Skip**, with "apply to all" for multi-file uploads |
| Rename | Blocked with an inline error and a suggested valid name |

**Replace creates a new row in `file_versions`** and repoints `current_version_id` — it never overwrites bytes. This is also what covers the optional versioning requirement.

Implementation notes:
- Conflicts are detected by catching Postgres `23505` from the unique index, not by a `SELECT` before `INSERT` — the latter is a time-of-check/time-of-use race under concurrent uploads.
- Names are normalised to Unicode NFC before comparison, so two byte-different spellings of `é` cannot coexist as visually identical siblings.
- Comparison is case-insensitive. Renaming only the case of a name excludes the node's own id from the conflict check.
- The rule applies to folders as well as files; they share one namespace per parent.

### Deletion

Soft delete (`deleted_at`), no user-facing trash.

- The brief calls out deleting a folder someone else is currently viewing. With a tombstone the API can answer `410 Gone`, and the viewer gets "This item was deleted by the owner" instead of an indistinguishable `404`.
- Blob deletion and metadata deletion are decoupled. A transaction spanning Postgres and object storage is not atomic; a background sweeper removes orphaned objects instead.
- Cascading a folder delete is one statement: `UPDATE nodes SET deleted_at = now() WHERE path LIKE :prefix || '%'`.
- Deleting a node does not touch its `shares` rows, and permission is resolved **before** the tombstone is checked. A recipient holding a valid share on a deleted subtree gets `410` and an explanation; a guessed token gets `404`. Checking `deleted_at` first is the natural way to write it and would turn `410` into an oracle for which node ids exist.

The cost is that every read must filter `deleted_at IS NULL`. All tree queries are funnelled through `NodesRepository` so the filter lives in one place — a Prisma client extension would not cover the `$queryRaw` calls where it matters most.

### Sharing

`shares` rows attach to any node — a data room root, a folder, or a single file. Effective permission is the **maximum grant across the ancestor chain**, so a link on a parent folder and a named grant on a child compose rather than shadow each other.

```
resolvePermission(user, node) -> 'owner' | 'editor' | 'viewer' | 'none'
```

One pure function, no I/O, exhaustively unit-tested. Every guard and every UI affordance derives from it.

### Public link vs named share

The brief requires that anyone holding a public link can view, so `/s/:token` is exempt from the auth guard.

Named shares deliberately reveal nothing to an unauthenticated visitor. The response depends on what we already know about the requester:

| Visitor | Response |
|---|---|
| Anonymous | "Sign in to view this item" — existence of the token is not confirmed |
| Signed in, email matches | Content |
| Signed in, email does not match | "This link isn't available for `<their own email>`" + switch-account action |

The mismatch message is built from the requester's own address, never the grantee's. Showing the intended recipient's email to whoever holds the token would leak who is on the deal — meaningful intelligence in an M&A context.

Shares granted to an email that has no account yet are stored as `grantee_email` and resolved to `grantee_user_id` on signup, so inviting someone who has not registered works without depending on email delivery.

---

## Edge cases handled

**Upload**
- Duplicate names within a folder (dialog, see above), including races between concurrent uploads
- Zero-byte files; oversized files rejected before upload starts
- Content sniffing — a `.pdf` carrying no PDF header is rejected in the browser for immediate feedback and, authoritatively, by a `Range` read of the stored object before the node is marked `ready`
- A PDF whose header is not at offset zero — a signed document inside a PKCS#7 container — is accepted, because it is a real document that renders
- Per-file cancel and retry; one failed file does not fail the batch
- Page refresh mid-upload leaves no orphaned rows (swept) or orphaned blobs (swept)

**Move / rename**
- Moving a folder into itself or into a descendant returns `400` (`path` prefix check)
- Name conflict in the destination folder — Keep both / Replace / Cancel, asked inside the move dialog. Replace is offered only file-over-file, because replacing a folder would delete its whole subtree
- A conflict against a file being uploaded into the destination right now: the unique index covers `uploading` rows, so the blocker is real but invisible in the listing, and the message says which it is
- The conflict message names what is in the way — "a file named X" rather than "an item" — and offers the next free-looking candidate as a one-click fix
- Rename that changes only letter case
- Moving a deep branch further down is refused before the transaction opens, rather than violating `nodes_depth_max` partway through the prefix update
- Empty, whitespace-only, over-length names, and names containing path separators or control characters
- Renaming or moving a room's root node is refused — that is the data room, and it has its own rename and delete

**Delete**
- The confirmation dialog reports real counts and total size from `GET /nodes/:id/stats`, computed server-side over the whole subtree — not from whatever the client happens to have loaded
- Deleting a folder a share recipient is currently viewing → `410` and an explanatory screen with a route back, while an unauthorised requester still gets `404` for the same node
- Deleting a folder with an upload in flight

**Sharing**
- Revoking access while a recipient has the page open — the next request fails; the leak window equals the signed-URL TTL (60s), documented rather than hidden
- Expired links
- Read-only recipients get `403` on any mutation, enforced server-side, not merely by hidden buttons
- A file moved out of a shared folder loses inherited access but keeps any direct grant
- Rate limiting on `/s/:token` to make token guessing impractical

**Viewing / listing**
- Empty folders, deep nesting, very long names (breadcrumbs collapse with an overflow menu)
- Signed URLs are never held: the viewer's URL is discarded when the preview closes, so reopening a file an hour later mints a fresh one instead of rendering against a dead token, and the download button asks for its own at the moment it is pressed
- A PDF the browser cannot render → "Preview unavailable" with a working download, not a blank frame
- Keyset pagination throughout; no `OFFSET`

---

## Security notes

- Storage bucket is private. Every object is reached through a signed URL with a 60-second TTL, minted only after a permission check.
- Share tokens are 256 bits of CSPRNG output. Only a SHA-256 hash is stored, so a database dump does not yield working links.
- `Referrer-Policy: no-referrer` on `/s/:token`, and full URLs are excluded from request logs, so tokens do not leak through the `Referer` header or log aggregation.
- Storage is served from a different origin than the app, so an uploaded file cannot execute in the app's origin.
- Nonexistent and forbidden resources both return `404` for unauthorised requesters — `403` would confirm that a resource exists. The same reasoning fixes the check order for deleted nodes: permission first, tombstone second, so `410` is only ever seen by someone who genuinely had access.
- `Content-Disposition: attachment` for anything that is not a PDF rendered inline, with RFC 5987 filename encoding.

---

## How it scales

### Total size and item count of a folder subtree

One prefix range scan, no recursion:

```sql
SELECT count(*) FILTER (WHERE n.type = 'file')   AS file_count,
       count(*) FILTER (WHERE n.type = 'folder') AS folder_count,
       coalesce(sum(v.size_bytes), 0)            AS total_bytes
FROM nodes n
LEFT JOIN file_versions v ON v.id = n.current_version_id
WHERE n.path LIKE :prefix || '%'
  AND n.deleted_at IS NULL
  AND n.status = 'ready';
```

This is exact and cheap at current scale. If subtree stats became hot enough to matter, the next step is a `folder_rollups` table maintained by triggers or an async worker, with the UI showing approximate figures. Deliberately not built — it trades correctness for speed to solve a problem this dataset does not have.

### One data room with 100,000 files

The tree is never loaded whole; only one folder's direct children are ever fetched.

- **Pagination:** keyset on `(sort_rank, lower(name), id)`, all ascending so a page is one tuple comparison. `OFFSET` degrades linearly and would sequential-scan deep pages.
- **Counts:** `LIMIT n+1` to derive "has more" rather than a full `COUNT(*)`.
- **Indexes:** as listed above; `nodes_listing` covers the listing sort exactly.
- **Rendering:** the file table is virtualised, so a 10,000-item folder renders a constant number of rows.
- **Search:** a GIN trigram index on `lower(name)`, because `LIKE '%term%'` cannot use a btree.
- **Storage:** unaffected — bytes never move through the API.

The first thing to break past this point is the soft-delete tombstone accumulation; the answer there is a purge job or partitioning by `data_room_id`.

### Extending sharing to per-user roles

`shares.role` already exists and already carries `'viewer' | 'editor'`. Adding editors means adding a case to `resolvePermission()` and the corresponding guards — no schema migration, no data backfill. Only `viewer` is exposed in the UI, because the brief specifies read-only recipients and shipping an unusable role toggle would violate "don't include unimplemented features".

---

## Testing

Tests are concentrated where a bug is a security incident rather than an inconvenience, not spread evenly for coverage.

- **`resolvePermission()`** — table-driven unit tests across owner, public link, named grant, revoked, expired, inherited-from-ancestor, and moved-out-of-scope cases. This function gates every read in the system.
- **Name conflict resolution and cycle detection** — unit tests, including the case-only rename and self-descendant move.
- **API security matrix** — e2e via Supertest: a non-owner gets `404`, a revoked token stops working, a viewer cannot mutate.
- **Happy path** — one Playwright run: sign in → create folder → upload → view → share.

Each of these is written in the same step as the code it covers, rather than in a
testing pass at the end. So far two tables exist: `resolvePermission()`, covering owner,
other-user and anonymous — the share cases arrive with shares — and upload name-conflict
resolution, covering the three answers to a collision, the case-only duplicate, the
abandoned-upload retry, and the size bounds.

---

## Where I used AI

_TODO — replace with what actually happened. Be specific; "used Claude for boilerplate" reads as filler._

Template:

- **Scaffolding:** generated the initial Nest module/controller/service skeletons and shadcn component wiring.
- **Design review:** talked through the tree representation (adjacency list vs materialised path vs closure table) and the name-conflict and soft-delete strategies. The trade-off tables in this README came out of that discussion; the decisions are mine.
- **Edge case enumeration:** asked for failure modes I had not considered — the NULL-in-unique-index issue and the `Referer` token leak both came from that and were verified independently.
- **Not used for:** the permission resolution logic and the share token handling, which I wrote and tested by hand because a subtle error there is a data leak.

---

## Known limitations

_TODO — keep this honest and specific. It is more convincing than a longer feature list._

- Revocation is not instantaneous: an already-issued signed URL stays valid for up to 60 seconds. Eliminating this would mean streaming bytes through the API, which was not worth the latency.
- Subtree statistics are computed on demand. Fine at this scale, would need rollups past roughly a million nodes.
- Soft-deleted rows are never purged.
- **Deleting a node or a room does not reclaim the bytes.** Deletion is a tombstone, and the upload sweeper only recognises an abandoned upload — a version with `size_bytes = 0` — so a finished file's object stays in the bucket after its row is tombstoned. Reclaiming it means a second sweep that nulls `nodes.current_version_id`, removes the `file_versions` rows and then deletes the objects, after a grace period long enough to make the delete recoverable. It is invisible in the product and it is the one place where getting it wrong destroys data, so it was left out deliberately rather than rushed.
- **A moved subtree leaves tombstoned descendants behind at their old path.** They are unreachable — every query in the app filters `deleted_at IS NULL` — but a future undelete would put them back in the wrong place. Including them in the prefix update would cost the partial index that makes the move one scan.
- **pdf.js downloads the whole document rather than paging into it.** Supabase Storage does not send `Access-Control-Expose-Headers`, so a cross-origin reader cannot see `Accept-Ranges` or `Content-Range` and range mode never turns on. Harmless under the 50 MB cap, and it has one useful side effect: once the document is in memory, a signed URL lapsing behind it changes nothing.
- **A document pdf.js cannot render falls back to "Preview unavailable" plus a download.** Encrypted PDFs are the common case; the file itself is still intact and still downloadable.
- Only `viewer` is implemented; `editor` exists in the schema but is not exposed.
- No audit log of who viewed what — a real data room would need one, and `shares` is the natural place to hang it.
- _TODO: anything you ran out of time for. Say what you would do, not that you would "add more tests"._
