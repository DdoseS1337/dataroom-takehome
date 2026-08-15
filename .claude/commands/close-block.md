---
description: Close out a work block — audit the diff against project invariants, deploy, log decisions.
argument-hint: [block number]
---

Close out Block $ARGUMENTS. Do not write new features in this command.

**1. Audit the diff against `CLAUDE.md` and the invariants in `docs/architecture.md`.** Report each finding as a line item. Look specifically for:

- A `nodes` query outside `NodesRepository`, or one missing `deleted_at IS NULL`
- A `SELECT` used to pre-check a name conflict instead of catching `23505`
- `isOwner` or a permission check inline in a component instead of `useCanPerform`
- Permission derived anywhere other than `resolvePermission()`
- A `403` returned where `404` is required for an unauthorised requester
- A `deleted_at` check that runs before `resolvePermission()`, which leaks existence through `410`
- A grantee email exposed to a requester who is not that grantee
- Architectural layering nobody asked for: `use-cases/`, `domain/`, `infrastructure/`
- A new dependency added without being flagged
- `console.log`, commented-out UI, or a disabled control with no behaviour

**2. Run `/code-review`** on the diff and fold its findings into the same list.

**3. Verify the state matrix** for any screen this block touched: loading, empty, error, and `410 Gone` where a shared item can vanish mid-view. Skeletons, not centred spinners.

**4. Check `README.md`** — it must not describe anything this block failed to deliver.

**5. Append to `DECISIONS.md`**, three to five lines, no more:

```
## Block N — <name>
Decided: <what>
Alternatives considered: <what and why rejected>
Deferred: <what, and the condition that would make it worth doing>
```

**6. Type-check, lint, test, then deploy both apps.** Confirm production responds.

Report findings first and wait for my go-ahead before fixing anything. Do not fix and report in the same turn.
