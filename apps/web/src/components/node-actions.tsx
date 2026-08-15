"use client";

import { DeleteDialog } from "@/components/delete-dialog";
import { MoveDialog } from "@/components/move-dialog";
import { NamePromptDialog } from "@/components/name-prompt-dialog";
import { ShareDialog } from "@/components/share-dialog";
import {
  useDeleteNode,
  useMoveNode,
  useRenameNode,
  type NodeSummary,
} from "@/lib/queries";

export type RowAction = "rename" | "move" | "delete" | "share";

/**
 * What the row asked for, and the row as it looked when it asked.
 *
 * `item` is a snapshot rather than a live reference on purpose. Rename and move edit the
 * cached listing the moment they are sent, so the row they act on is renamed or gone
 * before the server answers — a dialog reading it live would rename its own title
 * mid-request, and one rendered inside that row would be unmounted along with it,
 * taking the conflict question with it.
 *
 * `open` is separate from `target` so the item survives the closing animation. Clearing
 * both at once empties the dialog while it is still on screen.
 */
export interface RowActionTarget {
  kind: RowAction;
  item: NodeSummary;
  open: boolean;
}

export function openRowAction(
  kind: RowAction,
  item: NodeSummary,
): RowActionTarget {
  return { kind, item, open: true };
}

export function closeRowAction(
  current: RowActionTarget | null,
): RowActionTarget | null {
  return current && { ...current, open: false };
}

/**
 * Rename, move and delete for whichever row is currently acting — one set of dialogs for
 * the whole listing rather than one per row.
 *
 * They live above the table because that is what keeps them alive: every one of these
 * mutations edits the cached listing optimistically, which unmounts the row it edits.
 * A dialog owned by the row would vanish mid-request and drop whatever the server said,
 * which is exactly how the name-conflict question went missing.
 */
export function NodeActionDialogs({
  target,
  parentId,
  onClose,
}: {
  target: RowActionTarget | null;
  parentId: string;
  onClose: () => void;
}) {
  const rename = useRenameNode(parentId);
  const move = useMoveNode(parentId);
  const remove = useDeleteNode(parentId);

  // Nothing has been acted on yet in this folder.
  if (!target) return null;

  const { kind, item, open } = target;

  return (
    <>
      {kind === "rename" && (
        <NamePromptDialog
          // The snapshot's name, so the field is fresh for a new row or a second rename
          // of the same one — and stable while a request is in the air.
          key={`${item.id}:${item.name}`}
          open={open}
          onOpenChange={(next) => !next && onClose()}
          title={item.type === "folder" ? "Rename folder" : "Rename file"}
          description="Folders and files share one namespace, so a name has to be unique inside this folder."
          label="Name"
          placeholder={item.name}
          submitLabel="Rename"
          initialName={item.name}
          onSubmit={(name) => rename.mutateAsync({ id: item.id, name })}
        />
      )}

      {kind === "move" && (
        <MoveDialog
          key={item.id}
          open={open}
          onOpenChange={(next) => !next && onClose()}
          item={item}
          currentParentId={parentId}
          onMove={(targetId, onConflict) =>
            move.mutateAsync({
              id: item.id,
              targetId,
              name: item.name,
              onConflict,
            })
          }
        />
      )}

      {kind === "delete" && (
        <DeleteDialog
          key={item.id}
          open={open}
          onOpenChange={(next) => !next && onClose()}
          nodeId={item.id}
          name={item.name}
          type={item.type}
          onConfirm={() => remove.mutateAsync({ id: item.id, name: item.name })}
        />
      )}

      {/* Up here for the same reason as the rest, and one more: the panel mints a token
          that exists nowhere but in its own state, so a remount loses the only copy. */}
      {kind === "share" && (
        <ShareDialog
          key={item.id}
          open={open}
          onOpenChange={(next) => !next && onClose()}
          nodeId={item.id}
          name={item.name}
          type={item.type}
        />
      )}
    </>
  );
}
