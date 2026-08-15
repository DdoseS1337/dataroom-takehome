"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "./api";

export type Permission = "owner" | "editor" | "viewer" | "none";

export interface Room {
  id: string;
  name: string;
  rootNodeId: string;
  createdAt: string;
}

export interface NodeSummary {
  id: string;
  type: "folder" | "file";
  name: string;
  updatedAt: string;
  sizeBytes: number | null;
}

export interface NodeDetail {
  id: string;
  dataRoomId: string;
  parentId: string | null;
  type: "folder" | "file";
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Crumb {
  id: string;
  name: string;
}

export interface NodeResponse {
  node: NodeDetail;
  breadcrumbs: Crumb[];
  permission: Permission;
}

interface ChildrenPage {
  items: NodeSummary[];
  nextCursor: string | null;
}

/** What `useInfiniteQuery` keeps in the cache for a folder listing. */
interface ChildrenData {
  pages: ChildrenPage[];
  pageParams: unknown[];
}

export interface NodeStats {
  fileCount: number;
  folderCount: number;
  totalBytes: number;
}

export interface DownloadUrl {
  url: string;
  expiresAt: string;
}

export const queryKeys = {
  rooms: ["rooms"] as const,
  node: (id: string) => ["node", id] as const,
  children: (id: string) => ["node", id, "children"] as const,
  stats: (id: string) => ["node", id, "stats"] as const,
  downloadUrl: (id: string) => ["file", id, "download-url"] as const,
};

export function useRooms() {
  return useQuery({
    queryKey: queryKeys.rooms,
    queryFn: () => apiFetch<Room[]>("/rooms"),
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Room>("/rooms", { method: "POST", body: { name } }),
    onSuccess: (room) => {
      // Rooms are newest-first, so the new one belongs at the front — writing it in
      // directly avoids a refetch the user would see as a flicker.
      queryClient.setQueryData<Room[]>(queryKeys.rooms, (rooms) =>
        rooms ? [room, ...rooms] : [room],
      );
    },
  });
}

export function useNode(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.node(id ?? ""),
    queryFn: () => apiFetch<NodeResponse>(`/nodes/${id!}`),
    enabled: Boolean(id),
  });
}

export function useChildren(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.children(id ?? ""),
    queryFn: ({ pageParam }) =>
      apiFetch<ChildrenPage>(
        `/nodes/${id!}/children?limit=50` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(id),
  });
}

export function useRenameRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<Room>(`/rooms/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: (room) => {
      queryClient.setQueryData<Room[]>(queryKeys.rooms, (rooms) =>
        rooms?.map((existing) => (existing.id === room.id ? room : existing)),
      );
      // The room's name is also the root node's name, so the folder view's breadcrumbs
      // are now stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.node(room.rootNodeId) });
    },
  });
}

export function useDeleteRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/rooms/${id}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<Room[]>(queryKeys.rooms, (rooms) =>
        rooms?.filter((room) => room.id !== id),
      );
    },
    onError: (error) =>
      toast.error("Could not delete this data room", {
        description: messageOf(error),
      }),
  });
}

/**
 * The delete dialog's numbers. Server-side over the whole subtree, never derived from
 * the pages the client happens to hold — see docs/ui.md.
 */
export function useNodeStats(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.stats(id ?? ""),
    queryFn: () => apiFetch<NodeStats>(`/nodes/${id!}/stats`),
    enabled: Boolean(id) && enabled,
    // The folder can change while the dialog is open; showing a cached count from an
    // earlier visit would be exactly the wrong number in exactly the wrong dialog.
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Renaming is optimistic in place: the row's label changes at once, but its position
 * does not. The listing is keyset-ordered by `(folder-first, lower(name), id)`, so the
 * new position is not something the client can work out — the invalidation settles it.
 */
export function useRenameNode(parentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<NodeSummary>(`/nodes/${id}`, { method: "PATCH", body: { name } }),

    onMutate: async ({ id, name }) => {
      const rollback = await freezeListing(queryClient, parentId);
      patchListing(queryClient, parentId, (items) =>
        items.map((item) => (item.id === id ? { ...item, name } : item)),
      );
      return rollback;
    },

    onError: (error, { name }, rollback) => {
      rollback?.();
      // A conflict is answered inline in the rename dialog, which stays open. A toast
      // as well would be the same refusal said twice.
      if (error instanceof ApiError && error.code === "NAME_CONFLICT") return;
      toast.error(`Could not rename to "${name}"`, {
        description: messageOf(error),
      });
    },

    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.children(parentId ?? "") });
      // Its own breadcrumb trail carries the old name too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.node(id) });
    },
  });
}

/** The answer to a name clash in the destination, sent on a second attempt. */
export type ConflictChoice = "keepBoth" | "replace";

interface MoveVariables {
  id: string;
  targetId: string;
  name: string;
  onConflict?: ConflictChoice;
}

/** The row leaves this folder, so it is removed optimistically rather than edited. */
export function useMoveNode(parentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, targetId, onConflict }: MoveVariables) =>
      apiFetch<NodeSummary>(`/nodes/${id}`, {
        method: "PATCH",
        body: { parentId: targetId, ...(onConflict ? { onConflict } : {}) },
      }),

    onMutate: async ({ id }) => {
      const rollback = await freezeListing(queryClient, parentId);
      patchListing(queryClient, parentId, (items) =>
        items.filter((item) => item.id !== id),
      );
      return rollback;
    },

    onError: (error, { name }, rollback) => {
      rollback?.();
      // A clash is answered inside the move dialog, which stays open to ask. A toast as
      // well would be the same refusal said twice.
      if (error instanceof ApiError && error.code === "NAME_CONFLICT") return;
      toast.error(`Could not move "${name}"`, { description: messageOf(error) });
    },

    onSettled: (_data, _error, { id, targetId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.children(parentId ?? "") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.children(targetId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.node(id) });
    },
  });
}

export function useDeleteNode(parentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) =>
      apiFetch<void>(`/nodes/${id}`, { method: "DELETE" }),

    onMutate: async ({ id }) => {
      const rollback = await freezeListing(queryClient, parentId);
      patchListing(queryClient, parentId, (items) =>
        items.filter((item) => item.id !== id),
      );
      return rollback;
    },

    onError: (error, { name }, rollback) => {
      rollback?.();
      toast.error(`Could not delete "${name}"`, {
        description: messageOf(error),
      });
    },

    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.children(parentId ?? ""),
      }),
  });
}

/**
 * A signed URL for the viewer, good for sixty seconds.
 *
 * It is never held: `gcTime: 0` drops it the moment the preview closes, so reopening a
 * file minutes later fetches a live one rather than rendering against a dead token. That
 * is the refetch that matters in practice — once pdf.js has the document, the URL has
 * done its job and can lapse without the reader noticing.
 */
export function useDownloadUrl(fileId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.downloadUrl(fileId ?? ""),
    queryFn: () =>
      apiFetch<DownloadUrl>(
        `/files/${fileId!}/download-url?disposition=inline`,
      ),
    enabled: Boolean(fileId) && enabled,
    gcTime: 0,
    // A signed URL is not worth retrying against: if the API refused, it will refuse
    // again, and the preview has a real error state with a Download and a retry.
    retry: false,
  });
}

/**
 * Downloading asks for its own URL at the moment of the click rather than reusing the
 * viewer's. It is a different URL — `attachment` rather than `inline`, so Storage sends
 * the filename back — and a fresh one, so a button pressed ten minutes into reading a
 * document still works.
 */
export function useDownloadFile() {
  return useMutation({
    mutationFn: (fileId: string) =>
      apiFetch<DownloadUrl>(
        `/files/${fileId}/download-url?disposition=attachment`,
      ),
    onSuccess: ({ url }) => {
      // Storage answers with `Content-Disposition: attachment`, so this saves the file
      // rather than navigating the page away from the reader's place in the list.
      window.location.href = url;
    },
    onError: (error) =>
      toast.error("Could not download this file", {
        description: messageOf(error),
      }),
  });
}

export function useCreateFolder(parentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<NodeSummary>("/folders", {
        method: "POST",
        body: { parentId, name },
      }),
    // Refetch rather than splice: the list is keyset-ordered by (folder-first,
    // lower(name), id), and guessing where a new row lands across a page boundary
    // would show it in the wrong place or twice.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.children(parentId ?? ""),
      }),
  });
}

/**
 * Cancels any listing refetch already in the air — otherwise it lands after the
 * optimistic edit and overwrites it — and returns the undo for the snapshot it took.
 */
async function freezeListing(
  queryClient: QueryClient,
  parentId: string | undefined,
): Promise<() => void> {
  const key = queryKeys.children(parentId ?? "");
  await queryClient.cancelQueries({ queryKey: key });
  const snapshot = queryClient.getQueryData<ChildrenData>(key);
  return () => queryClient.setQueryData(key, snapshot);
}

function patchListing(
  queryClient: QueryClient,
  parentId: string | undefined,
  edit: (items: NodeSummary[]) => NodeSummary[],
) {
  queryClient.setQueryData<ChildrenData>(
    queryKeys.children(parentId ?? ""),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({ ...page, items: edit(page.items) })),
      },
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
