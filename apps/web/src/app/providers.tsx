"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { UploadConflictDialog } from "@/components/upload-conflict-dialog";
import { UploadQueuePanel } from "@/components/upload-queue";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { UploadQueueProvider } from "@/lib/uploads";

export function Providers({ children }: { children: ReactNode }) {
  // Created once per mount, not at module scope: a client shared across server
  // renders would leak one user's cached data into another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // A 4xx is an answer, not a hiccup — retrying a 404 three times just makes
            // the empty state take a second longer to appear.
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Above the router's page tree, so an upload survives navigating into another
            folder. Both surfaces render nothing while the queue is empty. */}
        <UploadQueueProvider>
          {children}
          <UploadQueuePanel />
          <UploadConflictDialog />
        </UploadQueueProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
