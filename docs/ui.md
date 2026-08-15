# UI

Screens, states, components, styling. Read before touching anything in `apps/web`.

This is graded first. Effort here counts more than effort anywhere else in the codebase.

## Screens — deliberately few

| Route | Contents |
|---|---|
| `/login` | Google + email/password, plus one "Try demo account" button |
| `/` | The owner's data rooms |
| `/d/:roomId/:nodeId?` | **The product.** Breadcrumbs, file table, toolbar, share panel |
| `/f/:fileId` | PDF view — a modal over the list with shallow routing, not a page |
| `/s/:token` | Public link entry |

Five routes. If a sixth appears, question it. `/d/...` carries most of the product and deserves most of the polish.

**File preview is a modal with shallow routing.** A separate page loses the list context behind it and breaks the sense of being inside a folder. The URL still updates so back works and the view is linkable.

**The file list is a table, not a card grid.** Due diligence is about names, dates, sizes — not thumbnails. A table is also simpler to virtualise.

**No folder tree in the sidebar.** It duplicates state that already lives in the main list, and keeping the two in sync is the single largest source of bugs in this kind of UI for no functional gain.

## Read-only mode

One prop threaded through the view tree, one hook:

```tsx
<DataRoomView permission="viewer" />
// every action gated by:
useCanPerform('upload' | 'rename' | 'move' | 'delete' | 'share')
```

Never `{isOwner && <Button/>}` scattered across components. With twenty scattered checks you will miss one, and the miss will be in the sharing path.

Hiding a control is presentation only — the server authorises independently.

## State matrix — every cell is required

| Screen | Loading | Empty | Error | Special |
|---|---|---|---|---|
| Data rooms | Skeleton rows | "No data rooms yet" + CTA | Retry | — |
| Folder contents | Skeleton rows | "This folder is empty" + drop zone | Retry | `410` — deleted while being viewed |
| PDF view | Page skeleton | — | "Preview unavailable" + Download | Signed URL expired → silent refetch |
| Share panel | Skeleton | "Not shared yet" | Retry | — |
| Search | Inline spinner | "No results for X" | — | — |

**Every cell ships in the block that builds the screen**, not in a polish pass at the end. A state matrix deferred to the last block is a state matrix that gets cut when the last block runs short — and this is the part that is graded second.

**Skeletons, not centred spinners.** A spinner in an empty frame is the fastest way to look unfinished, and it is the first thing a reviewer sees.

**`410 Gone` needs a real screen** — "This item was deleted by the owner" with a route back, not a blank page or an endless spinner. The brief names this case explicitly. It appears only for a requester who actually has permission on the deleted item; everyone else gets the ordinary not-found path, because the API answers `404`.

## Errors

Branch on `error.code`, never on message text. Codes are defined in `docs/architecture.md`.

`NAME_CONFLICT` opens the conflict dialog. `WRONG_ACCOUNT` shows the switch-account screen. `NODE_GONE` shows the deleted screen. Everything else falls back to a retryable error state.

## Upload

- Drag-and-drop zone plus a file picker
- A file whose first bytes are not `%PDF-` is rejected in the browser before the upload starts, so the user finds out immediately rather than after a full transfer. The server re-checks and is the authority.
- A visible queue with **per-file progress, cancel, and retry**
- One failed file must not fail the batch
- Conflict dialog: Keep both (default) / Replace / Skip, with "apply to all" for multi-file uploads
- Page refresh mid-upload leaves nothing broken behind

## Destructive actions

The delete dialog shows **real** counts and total size from `GET /nodes/:id/stats`, computed server-side over the whole subtree. Never counts derived from whatever the client happens to have loaded — that number is wrong the moment the folder is bigger than one page.

Wording names what disappears: "This will delete 3 folders and 47 files (128 MB)."

## Interaction

- Optimistic rename and move, with rollback and a toast on failure
- Breadcrumbs collapse with an overflow menu on long paths
- Keyboard: Enter to rename, Delete, Escape, arrow navigation
- Focus trap in every modal; focus returns to the trigger on close

## Styling

shadcn defaults make every take-home look identical. Three changes, about twenty minutes:

- An accent colour that is not the default blue
- Adjusted `--radius`
- A typeface with some character

Table rows 44–48px. This is a tool, not a landing page.

## Performance

- Keyset pagination throughout, never `OFFSET`
- The file table is virtualised, so a 10,000-item folder renders a constant number of rows
- The tree is never loaded whole — only the current folder's direct children

## Nothing half-built

No disabled buttons, no "coming soon", no menu item that does nothing. The brief says not to include unimplemented features, and a visible dead control is exactly that.
