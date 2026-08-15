-- Prisma picks ON DELETE SET NULL for every optional relation. On two of them that
-- default is wrong for this schema, and on a third the app needs a database-side
-- default. All three are hand-written for the same reason as the init migration.

-- A hard delete of a folder must not orphan its children. SET NULL would leave rows
-- with parent_id IS NULL, which docs/data-model.md rules out: they escape
-- nodes_name_uniq entirely (Postgres treats NULLs as distinct, so duplicate names
-- become possible) and drop out of every prefix scan while keeping a stale path.
--
-- NO ACTION rather than RESTRICT: RESTRICT is checked immediately, which would break
-- the legitimate case of deleting a whole data room, where the CASCADE from
-- data_rooms removes parents and children in one statement. NO ACTION is checked at
-- end of statement, so that still succeeds while a partial delete still fails.
ALTER TABLE "nodes" DROP CONSTRAINT "nodes_parent_id_fkey";
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- SET NULL here collides with shares_kind_shape: nulling the grantee of a user share
-- that has no grantee_email leaves a row that satisfies neither branch of the check,
-- so deleting the user fails outright instead of cleaning up. A grant to an account
-- that no longer exists has no meaning, so it goes with the account.
ALTER TABLE "shares" DROP CONSTRAINT "shares_grantee_user_id_fkey";
ALTER TABLE "shares" ADD CONSTRAINT "shares_grantee_user_id_fkey"
  FOREIGN KEY ("grantee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma's @updatedAt is applied by the client, so a raw INSERT — which is how every
-- tree write in NodesRepository is built — hits a not-null violation without this.
-- Raw UPDATEs must still set updated_at themselves; a default cannot cover those.
ALTER TABLE "nodes" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
