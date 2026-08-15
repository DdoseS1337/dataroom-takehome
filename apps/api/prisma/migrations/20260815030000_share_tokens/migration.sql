-- Sharing, and the one thing the original shape got wrong: a named share had no token.
--
-- `shares_kind_shape` allowed `token_hash` only on a link share, which left an invited
-- person with no URL to open. That is not merely inconvenient — it makes the answer
-- "you are signed in as the wrong account" impossible to give safely. On an ordinary
-- `/nodes/:id` request a stranger must get `404`, because a `403` would confirm the id
-- exists to anyone probing ids. Only a requester who presents a capability can be told
-- more than that, so `WRONG_ACCOUNT` can only live behind a token, and a named share
-- has to carry one. See docs/architecture.md — "Response to /s/:token depends on what
-- we already know about the requester".
--
-- Every share is now reachable exactly one way: through its own token. What still
-- differs between the two kinds is who the token lets in.
ALTER TABLE "shares" ALTER COLUMN "token_hash" SET NOT NULL;

ALTER TABLE "shares" DROP CONSTRAINT "shares_kind_shape";
ALTER TABLE "shares" ADD CONSTRAINT "shares_kind_shape" CHECK (
  (kind = 'link' AND grantee_user_id IS NULL AND grantee_email IS NULL)
  OR
  (kind = 'user' AND (grantee_user_id IS NOT NULL OR grantee_email IS NOT NULL))
);

-- One live invitation per person per node. Without it, inviting the same address twice
-- silently mints a second token and the panel lists the same person twice — with two
-- separate revoke buttons, only one of which takes the access away.
--
-- Partial on `revoked_at` so revoking and re-inviting works, and expression-based on
-- `lower(email)` so a differently-cased address is the same person. Both are why this is
-- hand-written: the API catches `23505` here rather than reading the table first, which
-- is the rule every other collision in this codebase follows.
CREATE UNIQUE INDEX "shares_grantee_uniq" ON "shares" ("node_id", lower("grantee_email"))
  WHERE "kind" = 'user' AND "grantee_email" IS NOT NULL AND "revoked_at" IS NULL;
