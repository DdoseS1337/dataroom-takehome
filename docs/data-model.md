# Data model

Schema, indexes, query rules. Read before writing a migration or a tree query.

## Tables

```
users(id, email, name, avatar_url)

data_rooms(id, owner_id, name, root_node_id)

nodes(
  id, data_room_id, parent_id,
  type: 'folder' | 'file',
  name,
  path,                 -- text, '/uuid/uuid/'
  depth,
  sort_rank,            -- smallint, generated: folder 0, file 1
  current_version_id,   -- null for folders
  status: 'uploading' | 'ready',
  created_by, created_at, updated_at, deleted_at
)

file_versions(id, node_id, storage_key, size_bytes, mime_type, checksum, version_no, created_at)

shares(
  id, node_id,
  kind: 'link' | 'user',
  token_hash,                       -- link only
  grantee_user_id, grantee_email,   -- user only
  role: 'viewer' | 'editor',
  expires_at, revoked_at, created_by, created_at
)
```

## Tree representation — materialised path

`parent_id` is the source of truth. `path` is a denormalised materialised path maintained in the same transaction as any structural change.

| Approach | Subtree query | Move | Complexity |
|---|---|---|---|
| Adjacency list only | Recursive CTE — one index scan per level, cost scales with depth | Single row update | Lowest |
| **Materialised path (chosen)** | One prefix range scan, depth-independent | Rewrite prefix for K descendants | Medium |
| Closure table | Index scan on `ancestor_id`, fastest both directions | Rebuild K × D rows | Highest |

Chosen because the expensive query here is "aggregate everything under this folder", which a prefix range scan answers in one pass regardless of depth. A closure table only pulls ahead on ancestor-direction and depth-bounded queries, neither of which this app issues, and it adds a second structure that must stay transactionally consistent through every insert, move, and delete — a desync there corrupts permission resolution silently.

**Deferring costs nothing:** a closure table is a pure derivative of `parent_id` and can be built later from existing data with no change to any column in `nodes`.

`path` is plain `text` with a `text_pattern_ops` index, not `ltree`. Prisma has no native `ltree` support, so every subtree query would fall back to untyped raw SQL. Depth capped at 32.

## Root nodes are real

Every data room has a materialised root node. Top-level items never have `parent_id IS NULL`.

Postgres treats NULLs in a unique index as distinct, so with a NULL root two files named `report.pdf` at the top level would both satisfy the constraint. A real root makes the constraint uniform at every level.

## Indexes — hand-written in migrations

Partial and expression indexes cannot be expressed in `schema.prisma`. Add them via `prisma migrate dev --create-only` and edit the generated SQL. **Do not drop them when regenerating migrations.**

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

**`nodes_name_uniq` deliberately does not filter on `status`.** It covers `uploading` rows so that `POST /files/init` raises `23505` before any bytes move — see `docs/architecture.md`. The cost is that an abandoned upload reserves its name for 15 minutes.

**`sort_rank` exists because `type` sorts the wrong way.** Folders must come first, but `'file' < 'folder'` alphabetically, so ordering by `type` ascending puts files first. The obvious repair — `ORDER BY type DESC, lower(name) ASC` — cannot be served as an ordered scan by an all-ascending btree, and it breaks tuple-comparison keyset, which requires uniform direction. A generated column sidesteps both:

```sql
ORDER BY sort_rank, lower(name), id
WHERE (sort_rank, lower(name), id) > (:rank, :name, :id)   -- keyset page
```

All three ascending, one index scan, one tuple comparison. `nodes_listing` column order matches that `ORDER BY` exactly; change one and you must change the other, or the index stops being used.

`sort_rank` is computed by Postgres and never written from application code. Declare it in `schema.prisma` so `migrate` does not try to drop it, and keep it out of every `create()` — listing queries are raw SQL in any case, because Prisma cannot express `ORDER BY lower(name)`.

## Name conflicts

The brief requires conflicts to be resolved but does not specify how. Chosen for the domain: in due diligence, a silent automatic action is harmful — `MSA.pdf` next to `MSA (1).pdf` means a lawyer may open the wrong document and nobody finds out.

| Situation | Behaviour |
|---|---|
| Upload / move | Dialog: Keep both (default) / Replace / Skip, with "apply to all" |
| Rename | Blocked, inline error with a suggested valid name |

**Replace inserts a new `file_versions` row and repoints `current_version_id`.** It never overwrites bytes. This is also what covers the optional versioning requirement.

Rules:
- Detect conflicts by catching `23505`, never by a `SELECT` first
- A `23505` against an `uploading` row older than 15 minutes is an abandoned upload, not a conflict: soft-delete that row and retry the insert once
- Normalise names to Unicode NFC before storing or comparing
- Comparison is case-insensitive; a case-only rename must exclude the node's own id from the check
- Files and folders share one namespace per parent

## Soft delete

`deleted_at`, no user-facing trash.

- The brief calls out deleting a folder someone is currently viewing. A tombstone lets the API answer `410 Gone` and the viewer see "deleted by the owner" instead of an indistinguishable `404`.
- **Deleting a node does not touch its `shares` rows, and permission resolves before the tombstone is checked.** A recipient with a valid share sees `410`; a guessed token sees `404`. Reversing that order leaks which ids exist.
- Blob and metadata deletion are decoupled — a transaction spanning Postgres and object storage is not atomic. A sweeper removes orphaned objects.
- Cascading a folder delete is one statement: `UPDATE nodes SET deleted_at = now() WHERE path LIKE :prefix || '%'`.

Cost: every read must filter `deleted_at IS NULL`. A Prisma client extension would not cover `$queryRaw`, which is where the important queries are — so the filter lives in `NodesRepository` instead, and all tree queries go through it.

## Move

Reject a move into self or a descendant via prefix check, not by walking parents:

```
if (target.path.startsWith(source.path)) -> CYCLE_DETECTED
```

A branch move is one prefix `UPDATE` plus the node's `parent_id`, in a single transaction.

## Roles

`shares.role` already carries `'viewer' | 'editor'`. Adding editors later means a case in `resolvePermission()` and the matching guards — no migration, no backfill. Only `viewer` is exposed in the UI, because the brief specifies read-only recipients and shipping an inert role toggle would violate "don't include unimplemented features".

## Prisma specifics

- `DATABASE_URL` on port 6543 with `?pgbouncer=true&connection_limit=1` for the running app
- `DIRECT_URL` on 5432 for migrations
- `schemas = ["public"]` — never introspect `auth` or `storage`
- Subtree aggregates, prefix updates, and cascading soft delete are `$queryRaw`, and they live only in `NodesRepository`
