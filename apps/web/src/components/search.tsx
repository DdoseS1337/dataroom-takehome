"use client";

import {
  FileTextIcon,
  FolderIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  EmptyState,
  ErrorState,
  RowsSkeleton,
  type BackRoute,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  MIN_SEARCH_TERM,
  useSearch,
  type ApiBase,
  type NodeSummary,
  type SearchHit,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Find a document by name anywhere in what you can see.
 *
 * The scope is a node id the API authorises once, and the caller hands it the first
 * breadcrumb — which Block 5 already cuts to the highest ancestor this requester may
 * read. So an owner searches their whole room, a recipient searches exactly the folder
 * they were given, and neither surface needs to know which of the two it is.
 *
 * Results are deliberately read-only: open a folder, open a file, nothing else. Rename,
 * move and delete edit a cached listing keyed by one parent id, and every row here has a
 * different parent — the optimistic edit would be written into a list that is not on
 * screen. Doing it properly is a rework of the mutation cache for a gain nobody asked
 * for; opening the item and acting on it there is one more click and always correct.
 */

/** Long enough that a fast typist does not fire a request per character, short enough
 * that the results feel like they are following the field. */
const DEBOUNCE_MS = 250;

export function useSearchTerm() {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  return {
    term,
    /** What the request is actually made with — the field, a beat behind. */
    query: debounced.trim(),
    active: term.trim().length >= MIN_SEARCH_TERM,
    setTerm,
    clear: () => {
      setTerm("");
      setDebounced("");
    },
  };
}

export function SearchField({
  term,
  scopeName,
  busy,
  onChange,
  onClear,
}: {
  term: string;
  /** The room, or the shared folder — whatever the top of this requester's trail is. */
  scopeName: string;
  busy: boolean;
  onChange: (term: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={term}
        onChange={(event) => onChange(event.target.value)}
        // Escape clears rather than blurs: the field is a filter over the screen behind
        // it, and getting back to that screen is the thing someone wants.
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClear();
          }
        }}
        placeholder={`Search in ${scopeName}`}
        aria-label={`Search in ${scopeName}`}
        className={cn(
          "h-9 w-full rounded-lg border border-input bg-transparent pr-16 pl-8 text-sm outline-none",
          "transition-colors placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          // Safari draws its own clear button on `type="search"`, next to ours.
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />

      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
        {/* The one place in this app a spinner is right, and `docs/ui.md` says so: a
            search that is re-running has results underneath it, so there is no empty
            frame for a skeleton to fill. */}
        {busy && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
        {term.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClear}
            className="text-muted-foreground"
          >
            <XIcon />
            <span className="sr-only">Clear search</span>
          </Button>
        )}
      </div>
    </div>
  );
}

export function SearchResults({
  scopeId,
  query,
  base,
  back,
  folderHref,
  onOpenFile,
}: {
  scopeId: string | undefined;
  query: string;
  base: ApiBase;
  back: BackRoute;
  folderHref: (nodeId: string) => string;
  onOpenFile: (file: NodeSummary) => void;
}) {
  const results = useSearch(scopeId, query, base);

  // `ErrorState` rather than a message of its own: the scope of a search is a real node,
  // and it can be deleted or its link revoked while someone is typing into the field.
  // Branching on `error.code` is what gives those their own screens, and doing it here
  // by hand would be the second place that has to know the codes.
  if (results.isError) {
    return (
      <ErrorState
        error={results.error}
        onRetry={() => void results.refetch()}
        back={back}
      />
    );
  }

  // Nothing at all yet: the very first term, before any answer has arrived. Once there
  // are results the spinner in the field carries the wait and the list stays put — so
  // this is the only moment the search has an empty frame to fill, and it fills it the
  // way every other empty frame in this app does.
  if (!results.data) return <RowsSkeleton rows={4} />;

  if (results.data.items.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={`No results for “${query}”`}
        description="Nothing here matches that name. Try a shorter term, or part of a word."
      />
    );
  }

  return (
    <>
      <ul className="divide-y">
        {results.data.items.map((hit) => (
          <HitRow
            key={hit.id}
            hit={hit}
            folderHref={folderHref}
            onOpenFile={onOpenFile}
          />
        ))}
      </ul>

      {/* Said rather than hidden: a list silently cut at fifty looks like the whole
          truth, and in a data room that is the kind of wrong that matters. */}
      {results.data.truncated && (
        <p className="border-t px-3 py-2.5 text-center text-xs text-muted-foreground">
          Showing the first {results.data.items.length} matches. Narrow the
          search to see the rest.
        </p>
      )}
    </>
  );
}

function HitRow({
  hit,
  folderHref,
  onOpenFile,
}: {
  hit: SearchHit;
  folderHref: (nodeId: string) => string;
  onOpenFile: (file: NodeSummary) => void;
}) {
  return (
    <li className="relative flex h-14 items-center gap-2.5 px-3 transition-colors hover:bg-muted/50">
      {hit.type === "folder" ? (
        <FolderIcon className="size-4 shrink-0 fill-primary/15 text-primary" />
      ) : (
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      )}

      <span className="min-w-0 flex-1">
        {hit.type === "folder" ? (
          <Link
            href={folderHref(hit.id)}
            className="block truncate rounded-sm text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {hit.name}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onOpenFile(hit)}
            className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {hit.name}
          </button>
        )}
        <span className="block truncate text-xs text-muted-foreground">
          {hit.parentName ? `in ${hit.parentName}` : "in this room"}
          {hit.sizeBytes !== null && ` · ${formatBytes(hit.sizeBytes)}`}
        </span>
      </span>

      <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">
        {formatDateTime(hit.updatedAt)}
      </span>
    </li>
  );
}
