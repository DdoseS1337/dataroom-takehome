"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiFetch } from "./api";
import { queryKeys } from "./queries";

/**
 * The upload queue. It is client state on purpose: a file in flight is deliberately
 * invisible to the API's listings (they return `status='ready'` only), so there is
 * nothing to optimistically insert into the cache — a row written there would be
 * filtered straight back out on the next fetch.
 *
 * Nothing here runs in an effect. Uploads start from the drop handler and each one
 * schedules the next as it finishes, so there is no render-phase state to synchronise
 * and no `setState` in an effect body.
 */

/** Mirrors the API's own limit. Two apps, one number, and the server is the authority. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const MAX_CONCURRENT = 3;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/**
 * A PDF header does not have to sit at byte zero. The spec tolerates leading bytes, and
 * pdf.js — the thing that actually renders these — searches the first kilobyte for the
 * header before giving up. Insisting on offset zero rejected real documents: a PDF
 * wrapped in a PKCS#7 signature container, the usual shape of a qualified electronic
 * signature, keeps its header around offset 70 and renders perfectly well.
 *
 * The API applies the same rule to the stored object and remains the authority.
 */
const HEADER_SCAN_BYTES = 1024;
const FOLDER_IN_THE_WAY = "A folder of this name already exists here.";
const FOLDER_DELETED =
  "The folder this was going into was deleted, so the upload stopped.";

export type UploadStatus =
  | "pending"
  | "uploading"
  | "finalising"
  | "conflict"
  | "done"
  | "error"
  | "cancelled"
  | "skipped";

export type ConflictChoice = "keepBoth" | "replace" | "skip";

type ConflictPolicy = "error" | "keepBoth" | "replace";

type ExistingType = "file" | "folder" | null;

export interface UploadItem {
  id: string;
  /** The name as dropped. Replaced by the stored name once the server has decided it. */
  name: string;
  sizeBytes: number;
  folderId: string;
  status: UploadStatus;
  /** 0 to 1, from the request itself — `fetch` cannot report upload progress. */
  progress: number;
  error: string | null;
  /** What already holds this name. A folder cannot be replaced by a file. */
  existingType: ExistingType;
  retriable: boolean;
}

export interface UploadActions {
  enqueue: (files: File[], folderId: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  dismissFinished: () => void;
  resolveConflict: (
    id: string,
    choice: ConflictChoice,
    applyToAll: boolean,
  ) => void;
}

// Two contexts rather than one: progress ticks several times a second, and the drop
// zone wrapping the file table must not re-render with every tick.
const ActionsContext = createContext<UploadActions | null>(null);
const ItemsContext = createContext<UploadItem[]>([]);

/** Everything an upload needs that is not worth re-rendering the tree over. */
interface Job {
  file: File;
  folderId: string;
  nodeId: string | null;
  /** The version this upload reserved, so completing and cancelling name their own. */
  versionId: string | null;
  existingType: ExistingType;
  request: XMLHttpRequest | null;
  cancelled: boolean;
  /** Whether `run` is between its checkpoints and will settle a cancellation itself. */
  running: boolean;
}

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);

  const jobs = useRef(new Map<string, Job>());
  const waiting = useRef<{ id: string; policy: ConflictPolicy }[]>([]);
  const active = useRef(0);
  /** An "apply to all" answer, standing until the queue drains. */
  const standing = useRef<ConflictChoice | null>(null);
  /** Conflicts waiting on the dialog, so one answer can settle all of them at once. */
  const parked = useRef(new Set<string>());

  useDropGuard();

  const actions = useMemo<UploadActions>(() => {
    function update(id: string, patch: Partial<UploadItem>) {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    }

    function pump() {
      while (active.current < MAX_CONCURRENT && waiting.current.length > 0) {
        const next = waiting.current.shift()!;
        active.current += 1;

        const job = jobs.current.get(next.id);
        if (job) job.running = true;

        void run(next.id, next.policy)
          // `run` asks to be re-queued rather than re-queueing itself, so a standing
          // answer cannot start a second `run` for the same file while the first is
          // still on the stack — which would leave two of them sharing one `running`
          // flag, the flag cancellation depends on.
          .then((requeue) => {
            if (requeue) waiting.current.push({ id: next.id, policy: requeue });
          })
          .finally(() => {
            const settled = jobs.current.get(next.id);
            if (settled) settled.running = false;
            active.current -= 1;
            pump();
          });
      }

      // Nothing left to answer for, so an "apply to all" from the finished batch must
      // not silently decide the next one.
      if (active.current === 0 && waiting.current.length === 0) {
        standing.current = null;
      }
    }

    function schedule(id: string, policy: ConflictPolicy) {
      waiting.current.push({ id, policy });
      pump();
    }

    /** Resolves to a policy when the file should be tried again, otherwise to null. */
    async function run(
      id: string,
      policy: ConflictPolicy,
    ): Promise<ConflictPolicy | null> {
      const job = jobs.current.get(id);
      if (!job) return null;

      update(id, {
        status: "uploading",
        progress: 0,
        error: null,
        existingType: null,
      });

      let reserved: {
        uploadUrl: string;
        nodeId: string;
        name: string;
        versionId: string;
      };
      try {
        reserved = await apiFetch("/files/init", {
          method: "POST",
          body: {
            parentId: job.folderId,
            name: job.file.name,
            sizeBytes: job.file.size,
            ...(policy === "error" ? {} : { onConflict: policy }),
          },
        });
      } catch (error) {
        if (await settleIfCancelled(id)) return null;

        if (error instanceof ApiError && error.code === "NAME_CONFLICT") {
          job.existingType = readExistingType(error);

          // A standing answer applies to the first collision only. If the retry that
          // carried it collides again — the server refuses to replace a file whose own
          // upload is still in flight — asking again is the only honest move, and it
          // is what stops this bouncing between here and the queue forever.
          if (standing.current && policy === "error") {
            const choice = standing.current;
            if (choice === "skip") {
              settleSkipped(id);
              return null;
            }
            if (choice === "replace" && job.existingType === "folder") {
              fail(id, FOLDER_IN_THE_WAY, false);
              return null;
            }
            update(id, { status: "pending", error: null, existingType: null });
            return choice;
          }

          parked.current.add(id);
          update(id, {
            status: "conflict",
            error: error.message,
            existingType: job.existingType,
          });
          return null;
        }

        // A 4xx is the server's verdict on this request — a name it will never accept,
        // or an item this account cannot write to. Offering Retry would be offering a
        // button that cannot work.
        fail(id, describe(error), !isRefusal(error));
        return null;
      }

      job.nodeId = reserved.nodeId;
      job.versionId = reserved.versionId;
      // "Keep both" may have adjusted the name, and showing the one the user dropped
      // would leave the queue disagreeing with the folder it just wrote to.
      update(id, { name: reserved.name });

      if (await settleIfCancelled(id)) return null;

      try {
        await put(job, reserved.uploadUrl, (progress) =>
          update(id, { progress }),
        );
      } catch (error) {
        if (await settleIfCancelled(id)) return null;
        await release(id);
        fail(id, describe(error), true);
        return null;
      }

      if (await settleIfCancelled(id)) return null;

      update(id, { status: "finalising", progress: 1 });

      try {
        await apiFetch(`/files/${reserved.nodeId}/complete`, {
          method: "POST",
          body: { versionId: reserved.versionId },
        });
      } catch (error) {
        // A `400` is the server's verdict on the bytes — not a PDF, empty, too large —
        // and it has already removed the node, so there is nothing left to retry
        // against. A `410` means the folder was deleted mid-upload: the node is a
        // tombstone and no retry will bring it back. Anything else, including a fault on
        // the storage side, leaves the upload worth another attempt from the beginning.
        const settled =
          error instanceof ApiError &&
          (error.status === 400 || error.code === "NODE_GONE");
        if (!settled) await release(id);
        fail(id, describe(error), !settled);
        return null;
      }

      update(id, { status: "done", progress: 1 });
      jobs.current.delete(id);
      invalidate(queryClient, job.folderId);
      return null;
    }

    function fail(id: string, message: string, retriable: boolean) {
      // A file cancelled while the request was in the air is cancelled, not failed —
      // otherwise it would come to rest showing an error and a Retry button.
      if (jobs.current.get(id)?.cancelled) {
        void settleIfCancelled(id);
        return;
      }
      parked.current.delete(id);
      update(id, { status: "error", error: message, retriable });
      if (!retriable) jobs.current.delete(id);
    }

    function settleSkipped(id: string) {
      parked.current.delete(id);
      update(id, { status: "skipped", error: null });
      jobs.current.delete(id);
    }

    /** True when the user cancelled mid-flight; cleans up whatever exists by then. */
    async function settleIfCancelled(id: string): Promise<boolean> {
      if (!jobs.current.get(id)?.cancelled) return false;
      await release(id);
      parked.current.delete(id);
      update(id, { status: "cancelled", progress: 0 });
      jobs.current.delete(id);
      return true;
    }

    /**
     * Releases the reserved name immediately. Without this a cancelled upload keeps its
     * name for fifteen minutes, and dropping the same file again answers with a conflict
     * against a row the folder does not show.
     */
    async function release(id: string) {
      const job = jobs.current.get(id);
      if (!job?.nodeId) return;

      const nodeId = job.nodeId;
      const versionId = job.versionId;
      job.nodeId = null;
      job.versionId = null;
      try {
        // Named, not implied: on a replacement the node also carries the file it is
        // replacing, and another replacement may be in flight beside this one.
        await apiFetch(
          `/files/${nodeId}${versionId ? `?versionId=${versionId}` : ""}`,
          { method: "DELETE" },
        );
      } catch {
        // The sweeper is the backstop. Reporting this would be a second failure notice
        // for something the user has already chosen to abandon.
      }
    }

    function applyChoice(id: string, choice: ConflictChoice) {
      const job = jobs.current.get(id);
      if (!job) return;

      // A folder holds the name, and there is nothing to replace it with.
      if (choice === "replace" && job.existingType === "folder") {
        fail(id, FOLDER_IN_THE_WAY, false);
        return;
      }

      if (choice === "skip") {
        settleSkipped(id);
        return;
      }

      parked.current.delete(id);
      update(id, { status: "pending", error: null, existingType: null });
      schedule(id, choice);
    }

    return {
      enqueue(dropped, folderId) {
        const created = dropped.map((file) => {
          const id = crypto.randomUUID();
          jobs.current.set(id, {
            file,
            folderId,
            nodeId: null,
            versionId: null,
            existingType: null,
            request: null,
            cancelled: false,
            running: false,
          });
          return {
            id,
            name: file.name,
            sizeBytes: file.size,
            folderId,
            status: "pending" as const,
            progress: 0,
            error: null,
            existingType: null,
            retriable: false,
          };
        });

        setItems((current) => [...current, ...created]);

        for (const item of created) {
          const job = jobs.current.get(item.id)!;
          // Screening happens off the queue, so a file that is not a PDF is flagged at
          // once rather than after three real uploads ahead of it have finished.
          void screen(job.file).then((rejection) => {
            if (rejection) {
              fail(item.id, rejection, false);
              return;
            }
            schedule(item.id, "error");
          });
        }
      },

      cancel(id) {
        const job = jobs.current.get(id);
        if (!job) return;

        job.cancelled = true;
        waiting.current = waiting.current.filter((next) => next.id !== id);

        if (job.request) {
          // The abort surfaces inside `run`, which cleans up and sets the final status.
          job.request.abort();
          return;
        }

        // Mid-request with nothing to abort — between reserving the name and sending
        // the bytes. Settling here would drop the job while `run` still needs it, and
        // `run` would carry on uploading into a node this had just deleted.
        if (job.running) return;

        // Queued, or parked on a conflict: nothing will look at this again.
        parked.current.delete(id);
        update(id, { status: "cancelled", progress: 0 });
        void release(id).then(() => jobs.current.delete(id));
      },

      retry(id) {
        const job = jobs.current.get(id);
        if (!job) return;

        job.cancelled = false;
        job.nodeId = null;
        job.versionId = null;
        update(id, {
          status: "pending",
          error: null,
          progress: 0,
          existingType: null,
        });
        schedule(id, "error");
      },

      dismiss(id) {
        jobs.current.delete(id);
        parked.current.delete(id);
        setItems((current) => current.filter((item) => item.id !== id));
      },

      dismissFinished() {
        setItems((current) => {
          const remaining = current.filter((item) => !isFinished(item));
          for (const item of current) {
            if (isFinished(item)) jobs.current.delete(item.id);
          }
          return remaining;
        });
      },

      resolveConflict(id, choice, applyToAll) {
        if (!applyToAll) {
          applyChoice(id, choice);
          return;
        }

        standing.current = choice;
        // Every file already waiting on the dialog gets this answer now, not only the
        // one on screen. Applying it to future collisions alone would leave the dialog
        // reappearing for each file that had already collided — which is precisely the
        // repetition "apply to all" exists to stop.
        for (const waitingId of [...parked.current]) {
          applyChoice(waitingId, choice);
        }
      },
    };
  }, [queryClient]);

  return (
    <ActionsContext value={actions}>
      <ItemsContext value={items}>{children}</ItemsContext>
    </ActionsContext>
  );
}

export function useUploadActions(): UploadActions {
  const actions = useContext(ActionsContext);
  if (!actions) {
    throw new Error("useUploadActions must be used inside UploadQueueProvider");
  }
  return actions;
}

export function useUploadItems(): UploadItem[] {
  return useContext(ItemsContext);
}

export function isFinished(item: UploadItem): boolean {
  return (
    item.status === "done" ||
    item.status === "error" ||
    item.status === "cancelled" ||
    item.status === "skipped"
  );
}

export function isInFlight(item: UploadItem): boolean {
  return !isFinished(item) && item.status !== "conflict";
}

/**
 * Cancellable only up to the point the bytes are all in storage. Once `/complete` is
 * verifying them there is nothing left to interrupt — the API refuses to cancel a file
 * it has already accepted — so no cancel control is offered for that moment rather than
 * one that would quietly fail.
 */
export function isCancellable(item: UploadItem): boolean {
  return item.status === "pending" || item.status === "uploading";
}

/**
 * `XMLHttpRequest` rather than `fetch`, for the one reason that decides it: `fetch`
 * reports nothing about how far an upload has got. The request carries no credentials
 * of ours — the signed URL is the authorisation — so nothing secret rides on it.
 */
function put(
  job: Job,
  url: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    job.request = request;

    let lastPercent = -1;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      // A repaint per percent, not per packet.
      const percent = Math.round((event.loaded / event.total) * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      onProgress(percent / 100);
    };

    request.onload = () => {
      job.request = null;
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(
        new Error(
          request.status === 413
            ? "This file is larger than the upload limit."
            : "The upload failed. Check your connection and try again.",
        ),
      );
    };
    request.onerror = () => {
      job.request = null;
      reject(new Error("Could not reach storage. Check your connection."));
    };
    request.onabort = () => {
      job.request = null;
      reject(new Error("Upload cancelled."));
    };

    request.open("PUT", url);
    // Set explicitly: the server refuses an object stored under any other type, and a
    // file the operating system has no association for arrives with an empty `type`.
    request.setRequestHeader("Content-Type", "application/pdf");
    request.send(job.file);
  });
}

/**
 * The browser's own check, for immediate feedback. It is advisory — the bytes go
 * straight to storage and the API never sees them in flight, so `/complete` re-reads
 * the stored object and is the authority. See docs/architecture.md.
 */
async function screen(file: File): Promise<string | null> {
  if (file.size === 0) return "This file is empty, so it cannot be a PDF.";
  if (file.size > MAX_FILE_BYTES) {
    return `This file is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit.`;
  }

  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, HEADER_SCAN_BYTES).arrayBuffer());
  } catch {
    // The file moved or was deleted between the drop and the read.
    return "This file could not be read.";
  }

  return hasPdfHeader(head)
    ? null
    : "This file is not a PDF — it carries no PDF header.";
}

function hasPdfHeader(head: Uint8Array): boolean {
  for (let start = 0; start <= head.length - PDF_MAGIC.length; start++) {
    if (PDF_MAGIC.every((byte, index) => head[start + index] === byte)) {
      return true;
    }
  }
  return false;
}

function invalidate(queryClient: QueryClient, folderId: string) {
  // Invalidate rather than splice: the listing is keyset-ordered, so where a new row
  // lands is not something the client can work out. Only the folder actually on screen
  // refetches — an inactive query is merely marked stale.
  void queryClient.invalidateQueries({
    queryKey: queryKeys.children(folderId),
  });
}

/**
 * Dropping a file anywhere the app does not handle makes the browser open it, which
 * navigates away and takes every upload in flight with it. The drop zone already
 * prevents that over the file list; this covers the rest of the window — the header,
 * the margins, the queue panel itself — so a near miss does nothing at all.
 */
function useDropGuard() {
  useEffect(() => {
    const swallow = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
    };

    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);
}

/** A 4xx is a verdict on the request itself, so repeating it verbatim cannot help. */
function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

function readExistingType(error: ApiError): ExistingType {
  const value = error.details?.existingType;
  return value === "file" || value === "folder" ? value : null;
}

/**
 * The API's wording, except for the one case where it is written for the wrong reader:
 * `NODE_GONE` says "This item was deleted by the owner", which in a queue row means the
 * folder someone was uploading into — not the file, which never existed.
 */
function describe(error: unknown): string {
  if (error instanceof ApiError && error.code === "NODE_GONE") {
    return FOLDER_DELETED;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
