"use client";

import { UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCanPerform } from "@/lib/permissions";
import { useUploadActions } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/**
 * Drag-and-drop for a folder's contents, plus the file picker that has to exist beside
 * it — dropping is not available from a keyboard and barely exists on touch.
 *
 * A read-only viewer gets the children with no drag handlers at all rather than a zone
 * that rejects the drop after the fact.
 */
export function DropZone({
  folderId,
  className,
  children,
}: {
  folderId: string;
  className?: string;
  children: ReactNode;
}) {
  const canUpload = useCanPerform("upload");
  const { enqueue } = useUploadActions();
  const [dragging, setDragging] = useState(false);

  // Dragging over a child fires dragleave on the parent, so a boolean alone flickers.
  // Counting enters and leaves is what makes the overlay stable over a full table.
  const depth = useRef(0);

  if (!canUpload) return <div className={className}>{children}</div>;

  function reset() {
    depth.current = 0;
    setDragging(false);
  }

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        // Without preventDefault the browser navigates to the dropped file instead.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        reset();
        const files = filesFrom(event.dataTransfer);
        if (files.length > 0) enqueue(files, folderId);
      }}
    >
      {children}

      {dragging && (
        // `pointer-events-none`, or the overlay itself becomes the drag target and the
        // enter/leave counting immediately goes wrong.
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/5 ring-2 ring-primary ring-inset">
          <span className="flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm font-medium shadow-sm">
            <UploadIcon className="size-4 text-primary" />
            Drop PDFs to upload
          </span>
        </div>
      )}
    </div>
  );
}

/** The file picker. Shares the queue with the drop zone, so both feed one list. */
export function UploadButton({
  folderId,
  variant = "default",
}: {
  folderId: string;
  variant?: "default" | "outline";
}) {
  const canUpload = useCanPerform("upload");
  const { enqueue } = useUploadActions();
  const input = useRef<HTMLInputElement>(null);

  if (!canUpload) return null;

  return (
    <>
      <Button variant={variant} onClick={() => input.current?.click()}>
        <UploadIcon />
        Upload PDFs
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) enqueue(files, folderId);
          // Cleared so that picking the same file twice in a row still fires `change`.
          event.target.value = "";
        }}
      />
    </>
  );
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Directories have to be recognised here and now: `DataTransferItemList` is emptied as
 * soon as the drop handler returns, so `webkitGetAsEntry` cannot be deferred. Dropping
 * a folder is a thing people try, and silently uploading nothing looks like a bug.
 */
function filesFrom(transfer: DataTransfer): File[] {
  const items = Array.from(transfer.items).filter(
    (item) => item.kind === "file",
  );
  if (items.length === 0) return Array.from(transfer.files);

  const files: File[] = [];
  let directories = 0;

  for (const item of items) {
    if (item.webkitGetAsEntry()?.isDirectory) {
      directories += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }

  if (directories > 0) {
    toast.warning(
      files.length > 0
        ? `Skipped ${directories === 1 ? "a folder" : `${directories} folders`} — only files can be uploaded.`
        : "Folders cannot be uploaded. Drop PDF files instead.",
    );
  }

  return files;
}
