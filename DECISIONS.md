# Decisions

One entry per block. What was chosen, what was rejected, what was deferred.

## Block 1 — scaffold

Decided: pnpm monorepo on Next 16 and Nest 11; Prisma 7 with the `pg` driver adapter, since v7 has no query engine and pool settings moved off the connection string; a `sort_rank` generated column so folders sort before files under an all-ascending index; `nodes_name_uniq` covering `uploading` rows so a name conflict fires at `/files/init` rather than after the bytes move; JWT verified locally via JWKS (the project uses ES256) with the HS256 path kept as a fallback; liveness `/health` split from readiness `/health/ready`, which gates the deploy.

Alternatives considered: `ORDER BY type DESC` instead of `sort_rank` — rejected because a mixed-direction sort cannot be served by an all-ascending btree and breaks tuple-comparison keyset; excluding `uploading` rows from the unique index — rejected because it moves the conflict to after the upload and lets two concurrent uploads of the same name both pass init; RLS as the access mechanism — rejected per `docs/architecture.md`, it stays a deny-all backstop; a single `/health` serving both liveness and the deploy gate — rejected because tolerating database blips and refusing traffic on a broken database cannot both live in one status code.

Deferred: P2002 handling when a Supabase email already belongs to another local `users` row, and eviction for the guard's `synced` map — both wait for Block 5, where pending shares resolve by email and the semantics of a changed address get settled; a closure table, which stays unnecessary until ancestor-direction queries appear.

## Block 2 — rooms, folders, navigation

Decided: TanStack Query for all data, because `react-hooks/set-state-in-effect` makes a fetching effect an error rather than a warning, and `useMutation`/`useInfiniteQuery` are what the optimistic rename and keyset paging in `docs/ui.md` need; folders and root nodes are written with `status='ready'` explicitly, since the column default is `uploading` and listings filter it out; the keyset cursor carries Postgres' own `lower(name)` rather than recomputing it in JS, where the collation would drift from the index; a mutation refused for a requester who *can* read returns `403`, not `404`, because existence is already known to them; design tokens were pulled forward from Block 6 so the two screens were not built twice.

Alternatives considered: server components with `@supabase/ssr` cookie sessions — rejected because `docs/architecture.md` has the browser hold the anon key and send a JWT, and cookie sessions would be a second auth mechanism; splicing a created folder into the cached page instead of invalidating — rejected because the list is keyset-ordered and a guessed insertion point shows the row twice or in the wrong place; hand-rolled dialogs instead of shadcn — rejected because `docs/ui.md` requires a focus trap and focus restoration in every modal, which Base UI already gets right; naming the next/font variable `--font-sans` — rejected after it shipped, because Tailwind emits `:root { --font-sans: … }` at the same specificity and the variable referenced itself, dropping the whole app to the browser's default serif.

Deferred: table virtualisation, which `docs/ui.md` requires but which only bites once files exist — Block 6; a decision on dark mode, since shadcn generated a full `.dark` token block that nothing activates — Block 6; unique room names and `PATCH`/`DELETE /rooms/:id`, because a root node has `parent_id IS NULL` and escapes `nodes_name_uniq`, and the real problem is that a mistyped room name cannot be corrected at all — Block 4.
