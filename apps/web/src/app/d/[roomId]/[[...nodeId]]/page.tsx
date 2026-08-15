"use client";

import { FolderOpenIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { NodeView, ViewSkeleton } from "@/components/folder-view";
import { EmptyState, ErrorState } from "@/components/states";
import { AuthGate } from "@/lib/auth";
import { useRooms } from "@/lib/queries";

export default function DataRoomPage() {
  return (
    <AuthGate fallback={<AppShell><ViewSkeleton /></AppShell>}>
      <AppShell>
        <Resolver />
      </AppShell>
    </AuthGate>
  );
}

/**
 * `/d/:roomId` with no node is a hand-typed or bookmarked URL — the app always links
 * to the root node explicitly. Resolving it from the already-cached room list and
 * redirecting keeps one canonical URL per folder, so breadcrumbs and browser history
 * do not end up with two addresses for the same view.
 */
function Resolver() {
  const params = useParams<{ roomId: string; nodeId?: string[] }>();
  const router = useRouter();
  const roomId = params.roomId;
  const nodeIdFromUrl = params.nodeId?.[0];

  const folderHref = useCallback(
    (nodeId: string) => `/d/${roomId}/${nodeId}`,
    [roomId],
  );

  const rooms = useRooms();
  const rootNodeId = rooms.data?.find((room) => room.id === roomId)?.rootNodeId;

  useEffect(() => {
    if (!nodeIdFromUrl && rootNodeId) {
      router.replace(`/d/${roomId}/${rootNodeId}`);
    }
  }, [nodeIdFromUrl, rootNodeId, roomId, router]);

  if (nodeIdFromUrl) {
    return (
      <NodeView
        nodeId={nodeIdFromUrl}
        folderHref={folderHref}
        back={{ href: "/", label: "Back to data rooms" }}
      />
    );
  }

  if (rooms.isError) {
    return <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />;
  }

  if (rooms.data && !rootNodeId) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={<FolderOpenIcon />}
          title="Data room not found"
          description="This room does not exist, or you do not have access to it."
        />
      </div>
    );
  }

  return <ViewSkeleton />;
}
