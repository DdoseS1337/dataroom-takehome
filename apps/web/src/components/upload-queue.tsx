"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import {
  isCancellable,
  isFinished,
  isInFlight,
  useUploadActions,
  useUploadItems,
  type UploadItem,
} from "@/lib/uploads";
import { cn } from "@/lib/utils";

/**
 * The queue, docked bottom right and outliving navigation between folders — an upload
 * that vanishes because you clicked into the next folder is the thing this exists to
 * prevent. Files in flight are not in any listing, so this panel is the only place
 * they appear until they are `ready`.
 */
export function UploadQueuePanel() {
  const items = useUploadItems();
  const { cancel, retry, dismiss, dismissFinished } = useUploadActions();
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  const settled = items.every(isFinished);

  return (
    <section
      aria-label="Uploads"
      className="fixed right-4 bottom-4 z-40 w-84 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover shadow-lg"
    >
      <header className="flex h-11 items-center gap-1 border-b bg-muted/40 pr-1.5 pl-3">
        <p aria-live="polite" className="flex-1 truncate text-sm font-medium">
          {summarise(items)}
        </p>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Expand uploads" : "Collapse uploads"}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronDownIcon
            className={cn("transition-transform", collapsed && "rotate-180")}
          />
        </Button>

        {/* Only once nothing is running: a close button during an upload reads as
            "cancel everything", which is not what it does. */}
        {settled && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close uploads"
            onClick={dismissFinished}
          >
            <XIcon />
          </Button>
        )}
      </header>

      {!collapsed && (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5 px-3 py-2.5">
              <Icon item={item} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8rem] font-medium">
                  {item.name}
                </p>
                <p
                  className={cn(
                    "text-xs",
                    item.status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {detail(item)}
                </p>
                {(item.status === "uploading" ||
                  item.status === "finalising") && (
                  <ProgressBar
                    value={item.progress}
                    indeterminate={item.status === "finalising"}
                  />
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {item.status === "error" && item.retriable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Retry ${item.name}`}
                    onClick={() => retry(item.id)}
                  >
                    <RotateCwIcon />
                  </Button>
                )}
                {isCancellable(item) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Cancel ${item.name}`}
                    onClick={() => cancel(item.id)}
                  >
                    <XIcon />
                  </Button>
                )}
                {isFinished(item) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Dismiss ${item.name}`}
                    onClick={() => dismiss(item.id)}
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Icon({ item }: { item: UploadItem }) {
  if (item.status === "done") {
    return (
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  return (
    <FileTextIcon
      className={cn(
        "mt-0.5 size-4 shrink-0",
        item.status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    />
  );
}

function ProgressBar({
  value,
  indeterminate,
}: {
  value: number;
  indeterminate: boolean;
}) {
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
          indeterminate && "animate-pulse",
        )}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function detail(item: UploadItem): string {
  switch (item.status) {
    case "pending":
      return "Waiting";
    case "uploading":
      return `${Math.round(item.progress * 100)}% of ${formatBytes(item.sizeBytes)}`;
    case "finalising":
      return "Checking the file…";
    case "conflict":
      return "A name conflict needs an answer";
    case "done":
      return formatBytes(item.sizeBytes);
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "error":
      return item.error ?? "Upload failed";
  }
}

function summarise(items: UploadItem[]): string {
  const running = items.filter(isInFlight).length;
  if (running > 0) {
    const done = items.filter((item) => item.status === "done").length;
    return `Uploading — ${done} of ${items.length} done`;
  }

  const failed = items.filter((item) => item.status === "error").length;
  if (failed > 0) return `${failed} of ${items.length} could not be uploaded`;

  const waiting = items.some((item) => item.status === "conflict");
  if (waiting) return "Waiting for your answer";

  const uploaded = items.filter((item) => item.status === "done").length;
  if (uploaded === 0) return "Nothing was uploaded";
  return uploaded === 1 ? "1 file uploaded" : `${uploaded} files uploaded`;
}
