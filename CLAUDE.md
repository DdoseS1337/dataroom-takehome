# CLAUDE.md

## What this is

A take-home project: a virtual data room for M&A due diligence. Nested folders, PDF upload, read-only sharing via public link or named recipients.

Graded in this order, and the order is load-bearing:

1. **User experience and functionality** — intuitive flows, handled edge cases, real error states
2. **Design and polish** — clean, nothing half-built visible
3. **Code quality and readability**

Backend elegance is third. Effort that does not surface in the UI is misallocated.

---

## Precedence — read this before anything else

**1. Project docs are binding. Imported skills are advisory.**

Where a skill's general best practice conflicts with a decision in `docs/`, the project doc wins. When that happens, say so explicitly — name the skill and the conflict — and follow the project doc. Never silently apply a skill's layering, abstraction, or testing convention over a stated project decision.

This matters most for general NestJS and clean-architecture skills. Their default advice targets large systems with many teams. This codebase has four entities and one author. Hexagonal layering, use-case classes, domain/infrastructure separation, mappers between layers, and repository interfaces over Prisma are all **out of scope** here, regardless of what a skill recommends.

**2. Skills are for API surface, not architecture.**

Use them for: Supabase client and storage API specifics, connection pooling flags, auth token handling, framework idioms you would otherwise guess at. Do not use them to decide how the project is structured — that is already decided in `docs/`.

**3. Decisions in `docs/` are closed.**

They were reasoned through before any code was written, with alternatives considered and rejected for stated reasons. If you believe one is wrong, say so in chat and wait. Do not implement an alternative silently.

---

## Which doc to read when

| Working on | Read |
|---|---|
| Anything, first time in a session | This file |
| API routes, services, auth, uploads, sharing | `docs/architecture.md` |
| Schema, migrations, indexes, queries | `docs/data-model.md` |
| Components, screens, states, styling | `docs/ui.md` |
| What to build next, in what order | `PLAN.md` |

Read the relevant doc before writing code, not after. They are short.

---

## How to work

- **One block at a time** from `PLAN.md`. Stop at the end of each block and report. Do not run ahead.
- **`/plan` before any block or non-trivial change.** State the approach in a few sentences and wait for confirmation before writing code.
- **`/close-block N` at the end of every block.** Deploy before moving on. Never accumulate two undeployed blocks.
- **Prefer the boring solution.** Fewer files, fewer indirections, fewer abstractions.
- **No new dependency without saying why.** Every package is something a reviewer has to trust.
- **When something is ambiguous, ask.** Do not pick a default and move on silently.
- **Comment only non-obvious reasoning** — why an index is partial, why a race is caught rather than checked. Never restate the code.

---

## Never in a commit

- `console.log`
- Commented-out UI sections
- Secrets, `.env` files, or a service role key in anything the browser receives
- A feature described in `README.md` that is not implemented
- A control that is visible but does nothing
