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

/** A listing row plus the folder it was found in — two files called `NDA.pdf` in
 * different folders is the normal case, so the name alone is not an answer. */
export interface SearchHit extends NodeSummary {
  parentName: string | null;
}

export interface SearchResults {
  items: SearchHit[];
  /** The cap was reached, so this is a prefix of the matches rather than all of them. */
  truncated: boolean;
}

export interface FileVersion {
  id: string;
  versionNo: number;
  sizeBytes: number;
  createdAt: string;
  isCurrent: boolean;
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

/**
 * Where a read comes from: the owner's own routes, or the public mirror behind a share
 * token. It is a path prefix and nothing else — `/s/<token>` in front of the same paths
 * — so one set of hooks and one set of components serve both.
 *
 * It is part of every cache key as well as every URL. The same node read through a link
 * and read as its owner are different answers to the same question — different
 * permission, a different breadcrumb trail — and sharing one cache entry would let the
 * recipient's trimmed trail overwrite the owner's.
 */
export type ApiBase = "" | `/s/${string}`;

export const queryKeys = {
  rooms: ["rooms"] as const,
  node: (id: string, base: ApiBase = "") => ["node", base, id] as const,
  children: (id: string, base: ApiBase = "") =>
    ["node", base, id, "children"] as const,
  stats: (id: string) => ["node", id, "stats"] as const,
  downloadUrl: (id: string, base: ApiBase = "") =>
    ["file", base, id, "download-url"] as const,
  search: (scopeId: string, term: string, base: ApiBase = "") =>
    ["search", base, scopeId, term] as const,
  versions: (fileId: string) => ["file", fileId, "versions"] as const,
  shares: (id: string) => ["node", id, "shares"] as const,
  shareEntry: (token: string) => ["share", token] as const,
  outgoingShares: ["shares", "outgoing"] as const,
  incomingShares: ["shares", "incoming"] as const,
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

export function useNode(id: string | undefined, base: ApiBase = "") {
  return useQuery({
    queryKey: queryKeys.node(id ?? "", base),
    queryFn: () => apiFetch<NodeResponse>(`${base}/nodes/${id!}`),
    enabled: Boolean(id),
  });
}

export function useChildren(id: string | undefined, base: ApiBase = "") {
  return useInfiniteQuery({
    queryKey: queryKeys.children(id ?? "", base),
    queryFn: ({ pageParam }) =>
      apiFetch<ChildrenPage>(
        `${base}/nodes/${id!}/children?limit=50` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(id),
  });
}

/**
 * Search by name inside one subtree. `scope` is a node id the API authorises once — the
 * caller passes the first breadcrumb, which is already trimmed to the highest ancestor
 * this requester may read, so an owner searches their room and a recipient searches their
 * shared folder without either knowing which they are.
 *
 * `placeholderData` keeps the previous results on screen while the next term is in
 * flight. Without it every keystroke empties the list and puts the loading state back,
 * which reads as the app losing its place rather than as it thinking.
 */
export function useSearch(
  scopeId: string | undefined,
  term: string,
  base: ApiBase = "",
) {
  const query = term.trim();

  return useQuery({
    queryKey: queryKeys.search(scopeId ?? "", query, base),
    queryFn: () =>
      apiFetch<SearchResults>(
        `${base}/search?q=${encodeURIComponent(query)}&scope=${scopeId!}`,
      ),
    enabled: Boolean(scopeId) && query.length >= MIN_SEARCH_TERM,
    placeholderData: (previous) => previous,
    // Never served from cache without checking. No mutation invalidates this key — a
    // rename, a move, a delete and an upload can each land anywhere in the subtree, and
    // making every one of them invalidate every term ever searched is a bookkeeping
    // exercise with a stale-result bug at the end of it. Asking again is one indexed
    // query, and `placeholderData` means the answer arrives without the list blinking.
    staleTime: 0,
  });
}

/** Matches the API's own floor. Below this a trigram index has no trigram to look up,
 * and asking anyway would be a scan of the room per keystroke. */
export const MIN_SEARCH_TERM = 2;

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
export function useDownloadUrl(
  fileId: string | undefined,
  enabled: boolean,
  base: ApiBase = "",
) {
  return useQuery({
    queryKey: queryKeys.downloadUrl(fileId ?? "", base),
    queryFn: () =>
      apiFetch<DownloadUrl>(
        `${base}/files/${fileId!}/download-url?disposition=inline`,
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
export function useDownloadFile(base: ApiBase = "") {
  return useMutation({
    mutationFn: (fileId: string) =>
      apiFetch<DownloadUrl>(
        `${base}/files/${fileId}/download-url?disposition=attachment`,
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

/**
 * Every finished version of a file. Owner only — the API refuses anyone else, and the
 * menu item that opens this is gated on the same rule.
 *
 * Fetched only while the panel is open, and dropped when it closes: a replacement made in
 * another tab should not be answered from a cache filled before it happened.
 */
export function useFileVersions(fileId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.versions(fileId ?? ""),
    queryFn: () => apiFetch<FileVersion[]>(`/files/${fileId!}/versions`),
    enabled: Boolean(fileId) && enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * An earlier version, as a download. Separate from `useDownloadFile` because it is a
 * different request with a different failure to report — and because the current version
 * is asked for by every reader, while this is asked for only from the history panel.
 */
export function useDownloadVersion() {
  return useMutation({
    mutationFn: ({ fileId, versionId }: { fileId: string; versionId: string }) =>
      apiFetch<DownloadUrl>(
        `/files/${fileId}/download-url?disposition=attachment&versionId=${versionId}`,
      ),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) =>
      toast.error("Could not download this version", {
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

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface Share {
  id: string;
  kind: "link" | "user";
  role: "viewer" | "editor";
  /** The invited address, on a named share. Only the owner ever sees this. */
  email: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** The plaintext token comes back once, when the share is created, and is never
 * retrievable again — only its hash is stored. */
export interface CreatedShare extends Share {
  token: string;
}

export interface ShareList {
  shares: Share[];
  /** A folder above this one is already shared, so this item is reachable even with
   * nothing of its own. */
  inherited: boolean;
}

export type ExpiryPreset = "never" | "24h" | "7d" | "30d";

/** What the recipient is told about the link they followed. Never the grantee. */
export interface ShareContext {
  id: string;
  kind: "link" | "user";
  role: "viewer" | "editor";
  rootNodeId: string;
  expiresAt: string | null;
}

export interface ShareEntry extends NodeResponse {
  share: ShareContext;
}

/** The panel's data. Fetched only while the panel is open — a guest list is not
 * something to hold in the cache of a tab that is not showing it. */
export function useShares(nodeId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.shares(nodeId ?? ""),
    queryFn: () => apiFetch<ShareList>(`/nodes/${nodeId!}/shares`),
    enabled: Boolean(nodeId) && enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCreateShare(nodeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      kind: "link" | "user";
      email?: string;
      expiresIn?: ExpiryPreset;
    }) =>
      apiFetch<CreatedShare>(`/nodes/${nodeId}/shares`, {
        method: "POST",
        body,
      }),
    // Refetched rather than spliced, so the row the panel shows is the row the server
    // has — and the token stays where the caller put it, in memory, out of the cache.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares(nodeId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.outgoingShares });
    },
  });
}

/** A shared item as it appears in one of the two overview lists. */
export interface SharedItem {
  id: string;
  type: "folder" | "file";
  name: string;
  roomId: string;
}

export interface OutgoingShare extends Share {
  item: SharedItem & { roomName: string };
}

export interface IncomingShare {
  id: string;
  role: "viewer" | "editor";
  expiresAt: string | null;
  createdAt: string;
  sharedBy: string;
  item: SharedItem;
}

/**
 * Everything currently shared out of this owner's rooms. The per-item panel can only
 * answer "who can see *this*", which means finding the item first — so without this
 * list, revoking depends on remembering where you shared something.
 */
export function useOutgoingShares() {
  return useQuery({
    queryKey: queryKeys.outgoingShares,
    queryFn: () => apiFetch<OutgoingShare[]>("/shares"),
  });
}

export function useIncomingShares() {
  return useQuery({
    queryKey: queryKeys.incomingShares,
    queryFn: () => apiFetch<IncomingShare[]>("/shares/received"),
  });
}

/**
 * `nodeId` is the panel this was revoked from, when there is one. The overview list is
 * invalidated either way — the same share appears in both places, and leaving one of
 * them showing access that has just been taken away is the worst kind of stale.
 */
export function useRevokeShare(nodeId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shareId: string) =>
      apiFetch<void>(`/shares/${shareId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (nodeId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shares(nodeId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.outgoingShares });
    },
    onError: (error) =>
      toast.error("Could not revoke this access", {
        description: messageOf(error),
      }),
  });
}

/**
 * The entry point of a shared link: what was shared, and what this requester is allowed
 * to know about it. Everything the recipient does afterwards goes through the ordinary
 * hooks with `/s/<token>` as their base.
 *
 * No retry: every refusal here — sign in, wrong account, revoked, gone — is a final
 * answer, and repeating the request three times only delays the screen that explains it.
 */
export function useShareEntry(token: string) {
  return useQuery({
    queryKey: queryKeys.shareEntry(token),
    queryFn: () => apiFetch<ShareEntry>(`/s/${token}`),
    retry: false,
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
