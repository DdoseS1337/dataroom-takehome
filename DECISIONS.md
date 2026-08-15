# Decisions

One entry per block. What was chosen, what was rejected, what was deferred.

## Block 1 — scaffold

Decided: pnpm monorepo on Next 16 and Nest 11; Prisma 7 with the `pg` driver adapter, since v7 has no query engine and pool settings moved off the connection string; a `sort_rank` generated column so folders sort before files under an all-ascending index; `nodes_name_uniq` covering `uploading` rows so a name conflict fires at `/files/init` rather than after the bytes move; JWT verified locally via JWKS (the project uses ES256) with the HS256 path kept as a fallback; liveness `/health` split from readiness `/health/ready`, which gates the deploy.

Alternatives considered: `ORDER BY type DESC` instead of `sort_rank` — rejected because a mixed-direction sort cannot be served by an all-ascending btree and breaks tuple-comparison keyset; excluding `uploading` rows from the unique index — rejected because it moves the conflict to after the upload and lets two concurrent uploads of the same name both pass init; RLS as the access mechanism — rejected per `docs/architecture.md`, it stays a deny-all backstop; a single `/health` serving both liveness and the deploy gate — rejected because tolerating database blips and refusing traffic on a broken database cannot both live in one status code.

Deferred: P2002 handling when a Supabase email already belongs to another local `users` row, and eviction for the guard's `synced` map — both wait for Block 5, where pending shares resolve by email and the semantics of a changed address get settled; a closure table, which stays unnecessary until ancestor-direction queries appear.
