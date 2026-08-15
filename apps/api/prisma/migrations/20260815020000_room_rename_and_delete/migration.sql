-- Rooms become renameable and deletable, which needs two things they never had: a
-- tombstone, and a unique name.
--
-- Why the name was never unique: a root node has `parent_id IS NULL`, Postgres treats
-- NULLs in a unique index as distinct, and so `nodes_name_uniq` never applied to rooms.
-- Two rooms with the same name pass. The real problem is not the duplicate, though —
-- it is that a mistyped room name could not be corrected at all. See PLAN.md, block 4.

ALTER TABLE "data_rooms" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Any database created before this migration can already hold duplicates, so the index
-- cannot simply be added. Rename the later ones with the same " (n)" convention the
-- upload conflict resolver uses, and keep the root node in step — a room's name lives in
-- both rows. The inner loop skips a suffix that is itself taken, so this terminates on
-- any data rather than only on data without a pre-existing "Foo (2)".
DO $$
DECLARE
  duplicate record;
  candidate  text;
  suffix     int;
BEGIN
  FOR duplicate IN
    SELECT id, owner_id, name, root_node_id
    FROM (
      SELECT r.*,
             row_number() OVER (
               PARTITION BY r.owner_id, lower(r.name)
               ORDER BY r.created_at, r.id
             ) AS ordinal
      FROM "data_rooms" r
      WHERE r.deleted_at IS NULL
    ) ranked
    WHERE ordinal > 1
    ORDER BY created_at, id
  LOOP
    suffix := 2;
    LOOP
      candidate := duplicate.name || ' (' || suffix || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "data_rooms"
        WHERE owner_id = duplicate.owner_id
          AND lower(name) = lower(candidate)
          AND deleted_at IS NULL
      );
      suffix := suffix + 1;
    END LOOP;

    UPDATE "data_rooms" SET name = candidate WHERE id = duplicate.id;
    UPDATE "nodes"
    SET name = candidate, updated_at = now()
    WHERE id = duplicate.root_node_id;
  END LOOP;
END $$;

-- Partial on the tombstone, exactly like `nodes_name_uniq`: a deleted room must not hold
-- its name against a new one.
CREATE UNIQUE INDEX "data_rooms_name_uniq" ON "data_rooms" ("owner_id", lower("name"))
  WHERE "deleted_at" IS NULL;
