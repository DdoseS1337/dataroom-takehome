-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "node_type" AS ENUM ('folder', 'file');

-- CreateEnum
CREATE TYPE "node_status" AS ENUM ('uploading', 'ready');

-- CreateEnum
CREATE TYPE "share_kind" AS ENUM ('link', 'user');

-- CreateEnum
CREATE TYPE "share_role" AS ENUM ('viewer', 'editor');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_rooms" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "root_node_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "data_room_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "node_type" NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    -- Hand-edited: Prisma emits a plain column here. Postgres computes it, so folders
    -- sort before files without a mixed-direction ORDER BY. See docs/data-model.md.
    "sort_rank" SMALLINT NOT NULL GENERATED ALWAYS AS (CASE WHEN "type" = 'folder' THEN 0 ELSE 1 END) STORED,
    "status" "node_status" NOT NULL DEFAULT 'uploading',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "current_version_id" UUID,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT,
    "version_no" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shares" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "kind" "share_kind" NOT NULL,
    "token_hash" TEXT,
    "grantee_user_id" UUID,
    "grantee_email" TEXT,
    "role" "share_role" NOT NULL DEFAULT 'viewer',
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "data_rooms_root_node_id_key" ON "data_rooms"("root_node_id");

-- CreateIndex
CREATE INDEX "data_rooms_owner_id_idx" ON "data_rooms"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_current_version_id_key" ON "nodes"("current_version_id");

-- CreateIndex
CREATE INDEX "nodes_data_room_id_idx" ON "nodes"("data_room_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_node_id_version_no_key" ON "file_versions"("node_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "shares_token_hash_key" ON "shares"("token_hash");

-- CreateIndex
CREATE INDEX "shares_node_id_idx" ON "shares"("node_id");

-- CreateIndex
CREATE INDEX "shares_grantee_user_id_idx" ON "shares"("grantee_user_id");

-- CreateIndex
CREATE INDEX "shares_grantee_email_idx" ON "shares"("grantee_email");

-- AddForeignKey
ALTER TABLE "data_rooms" ADD CONSTRAINT "data_rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_rooms" ADD CONSTRAINT "data_rooms_root_node_id_fkey" FOREIGN KEY ("root_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_data_room_id_fkey" FOREIGN KEY ("data_room_id") REFERENCES "data_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_grantee_user_id_fkey" FOREIGN KEY ("grantee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below this line. Prisma cannot express partial or expression
-- indexes, generated columns, or RLS. Do not drop these when regenerating.
-- Rationale for each: docs/data-model.md.
-- ---------------------------------------------------------------------------

-- One namespace per parent for files and folders, case-insensitive.
-- Deliberately NOT filtered on status: covering 'uploading' rows is what makes
-- POST /files/init raise 23505 before any bytes move.
CREATE UNIQUE INDEX "nodes_name_uniq" ON "nodes" ("parent_id", lower("name"))
  WHERE "deleted_at" IS NULL;

-- Subtree work is a prefix range scan; btree needs text_pattern_ops for LIKE 'x%'.
CREATE INDEX "nodes_path_prefix" ON "nodes" ("path" text_pattern_ops)
  WHERE "deleted_at" IS NULL;

-- Column order matches the listing ORDER BY exactly: sort_rank, lower(name), id.
-- All ascending, so keyset paging is one tuple comparison.
CREATE INDEX "nodes_listing" ON "nodes" ("parent_id", "sort_rank", lower("name"), "id")
  WHERE "deleted_at" IS NULL;

-- Depth cap. A runaway move that deepened the tree without bound would make
-- path rewrites unbounded too.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_depth_max" CHECK ("depth" >= 0 AND "depth" <= 32);

-- A link share has a token and no grantee; a user share has a grantee and no token.
ALTER TABLE "shares" ADD CONSTRAINT "shares_kind_shape" CHECK (
  (kind = 'link' AND token_hash IS NOT NULL AND grantee_user_id IS NULL AND grantee_email IS NULL)
  OR
  (kind = 'user' AND token_hash IS NULL AND (grantee_user_id IS NOT NULL OR grantee_email IS NOT NULL))
);

-- RLS is a backstop against accidental anon-key access, never the access
-- mechanism: authorisation lives in resolvePermission(). No policies are created,
-- so every role except the service role (which bypasses RLS) is denied.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shares" ENABLE ROW LEVEL SECURITY;
