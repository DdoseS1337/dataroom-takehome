---
description: Build one full endpoint slice — API, repository, tests, frontend hook — following project invariants.
argument-hint: [METHOD /path — short description]
---

Implement the endpoint slice: $ARGUMENTS

Re-read the invariants section of `docs/architecture.md` before starting. Then work in this order and stop if any step contradicts a frozen decision:

1. **Confirm the contract.** The route and response shape must already appear in the frozen API contract in `docs/architecture.md`. If it does not, stop and tell me — do not invent a route.

2. **Repository layer.** Any query touching `nodes` goes in `NodesRepository` and filters `deleted_at IS NULL`. Subtree work uses a `path` prefix scan, never a recursive CTE. Raw SQL is fine here and belongs only here.

3. **Service layer.** Business rules only. Authorisation goes through `resolvePermission()` — never re-derive permission inline. Name conflicts are caught from Postgres `23505`, never pre-checked with a SELECT.

4. **Controller.** Thin. Validation via DTO, errors as `{ code, message, details? }` using an existing code from the contract. Add a new code only if genuinely new, and tell me when you do.

5. **Tests.** Only if this slice touches permissions, name conflicts, or tree structure. Table-driven. No DTO-validation tests.

6. **Frontend.** A typed hook plus the UI that consumes it. Handle loading, empty, and error. Branch on `error.code`, never on message text. If the action mutates, gate it with `useCanPerform`.

When done, report in this format and nothing more:

- Files changed
- Any assumption you had to make
- What you deliberately did not handle
