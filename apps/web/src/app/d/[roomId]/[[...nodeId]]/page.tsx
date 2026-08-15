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
        <Room />
      </AppShell>
    </AuthGate>
  );
}

/**
 * Two different screens behind one route, and they are kept apart because they need
 * different data. With a node in the URL — which is every link the app itself produces —
 * the room list is not needed at all, and asking for it would be a request for somebody
 * else's library on the path a share recipient walks, where the answer is always empty.
 */
function Room() {
  const params = useParams<{ roomId: string; nodeId?: string[] }>();
  const roomId = params.roomId;
  const nodeId = params.nodeId?.[0];

  const folderHref = useCallback(
    (id: string) => `/d/${roomId}/${id}`,
    [roomId],
  );

  if (!nodeId) return <RootRedirect roomId={roomId} />;

  return (
    <NodeView
      nodeId={nodeId}
      folderHref={folderHref}
      back={{ href: "/", label: "Back to data rooms" }}
    />
  );
}

/**
 * `/d/:roomId` with no node is a hand-typed or bookmarked URL — the app always links to
 * the root node explicitly. Resolving it from the room list and redirecting keeps one
 * canonical URL per folder, so breadcrumbs and browser history do not end up with two
 * addresses for the same view.
 */
function RootRedirect({ roomId }: { roomId: string }) {
  const router = useRouter();
  const rooms = useRooms();
  const rootNodeId = rooms.data?.find((room) => room.id === roomId)?.rootNodeId;

  useEffect(() => {
    if (rootNodeId) router.replace(`/d/${roomId}/${rootNodeId}`);
  }, [rootNodeId, roomId, router]);

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
