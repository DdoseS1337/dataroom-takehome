"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./api";

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

export const queryKeys = {
  rooms: ["rooms"] as const,
  node: (id: string) => ["node", id] as const,
  children: (id: string) => ["node", id, "children"] as const,
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
