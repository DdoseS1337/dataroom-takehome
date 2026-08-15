-- Search by name, which needs an index a btree cannot provide.
--
-- The query is `lower(name) LIKE '%term%'`. A leading wildcard makes a btree useless —
-- there is no prefix to descend on — so it would be a sequential scan of every live node
-- in the room on every keystroke. A trigram GIN index answers the same predicate by
-- looking up the three-character sequences the pattern contains.
--
-- The extension is installed into `extensions`, which is where Supabase keeps them, and
-- the operator class is named with its schema rather than trusted to `search_path`: the
-- app connects through the pooler, and an index that fails to build at deploy time
-- because a search path differed is not a failure worth risking. The predicate itself
-- uses `LIKE`, whose operator lives in `pg_catalog`, so planning a query needs no search
-- path either — that is the reason not to reach for pg_trgm's own `%` similarity
-- operator here.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Partial on the same two conditions every listing already filters by, so the index holds
-- only rows that can be returned: no tombstones, and no half-finished uploads.
--
-- The scope of a search is a subtree, checked with `path LIKE prefix || '%'`, which
-- `nodes_path_prefix` already serves. Postgres intersects the two.
CREATE INDEX "nodes_name_trgm" ON "nodes"
  USING gin (lower("name") extensions.gin_trgm_ops)
  WHERE "deleted_at" IS NULL AND "status" = 'ready';
