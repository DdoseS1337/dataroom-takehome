"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { DocumentSkeleton } from "@/components/states";

/**
 * The renderer, in its own module so the folder view can load it lazily — pdf.js is
 * large and nothing outside the preview needs it.
 *
 * react-pdf rather than an `<iframe>`: the states `docs/ui.md` requires — a page
 * skeleton, "Preview unavailable" with a download — are things an iframe cannot report.
 * It either paints a document or it does not, and which of those happened is not
 * observable from the page around it.
 *
 * Everything pdf.js fetches at runtime is served from `/pdf`, copied out of the pinned
 * `pdfjs-dist` at build time by `scripts/copy-pdf-assets.mjs`. A CDN would make a
 * document that renders correctly depend on a third-party host.
 */
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

/** Outside the component on purpose: a fresh object every render restarts the load. */
const DOCUMENT_OPTIONS = {
  cMapUrl: "/pdf/cmaps/",
  standardFontDataUrl: "/pdf/standard_fonts/",
  wasmUrl: "/pdf/wasm/",
};

const MAX_PAGE_WIDTH = 900;

export function PdfDocument({
  url,
  onFailed,
  onProgress,
}: {
  url: string;
  onFailed: () => void;
  /**
   * How far along, for the line the preview draws along its top edge. `null` means the
   * first page is on screen and there is nothing left to wait for.
   *
   * Reported outward rather than drawn here because the line belongs to the frame, not
   * to the pages: it has to sit at the top of the scroll view, above a document that
   * may be a hundred pages long.
   */
  onProgress?: (progress: number | null) => void;
}) {
  const [pageCount, setPageCount] = useState(0);
  const { ref, width } = useMeasuredWidth();

  // Two separate waits, and both used to look like nothing happening. The document is
  // fetched whole — range requests never turn on, see README — so a large file spends
  // that time in `loading`; and once it has loaded, the pages still cannot be drawn
  // until the observer has reported a width, which is a tick later.
  const drawable = pageCount > 0 && width > 0;

  return (
    // The padding belongs to the preview around this, which also draws the loading line
    // — both have to cover the waits that happen before this component even loads.
    <div ref={ref} className="flex flex-col items-center gap-4">
      <Document
        file={url}
        options={DOCUMENT_OPTIONS}
        onLoadSuccess={({ numPages }) => setPageCount(numPages)}
        onLoadProgress={({ loaded, total }) =>
          onProgress?.(total > 0 ? loaded / total : 0)
        }
        onLoadError={onFailed}
        onSourceError={onFailed}
        // Nothing to show for either: until the first page is painted this whole
        // component is invisible behind the preview's own placeholder, and the failure
        // state belongs to the preview too.
        loading={null}
        error={null}
        className="flex w-full flex-col items-center gap-4"
      >
        {drawable &&
          Array.from({ length: pageCount }, (_, index) => (
            <LazyPage
              key={index}
              pageNumber={index + 1}
              width={width}
              first={index === 0}
              // The wait ends when the first page is actually on screen, not when the
              // download finished — those are two different moments, and the gap
              // between them is the one that looked like a hang.
              onPainted={index === 0 ? () => onProgress?.(null) : undefined}
            />
          ))}
      </Document>
    </div>
  );
}

/**
 * One page, rendered only once it is near the viewport — and kept behind its placeholder
 * until it has actually been painted.
 *
 * Two separate problems, and the second one is the one that shows.
 *
 * Mounting every page at once is what react-pdf's examples do, and it is why a long
 * document sat still for seconds after it had finished downloading: each page rasterises
 * to its own canvas on the main thread, so the first one — the only one anybody is
 * waiting for — queues behind all the rest.
 *
 * And `<Page>` drops its own `loading` element as soon as pdf.js has handed over the
 * page *object*, which is well before `render()` has drawn anything into the canvas. For
 * a heavy scan that is a second or more of a blank white rectangle where the placeholder
 * used to be: the wait looks finished while nothing is on screen. So the placeholder
 * stays until `onRenderSuccess`, and the page is hidden rather than absent underneath it
 * — a canvas draws just as well with `display: none`, because its size comes from the
 * `width` prop and not from layout.
 */
function LazyPage({
  pageNumber,
  width,
  first,
  onPainted,
}: {
  pageNumber: number;
  width: number;
  first: boolean;
  onPainted?: () => void;
}) {
  const [near, setNear] = useState(first);
  const [painted, setPainted] = useState(false);
  const slot = useRef<HTMLDivElement | null>(null);

  function settle() {
    setPainted(true);
    onPainted?.();
  }

  useEffect(() => {
    if (near) return;
    const element = slot.current;
    if (!element) return;

    // Against the panel that actually scrolls, not the window. With the default root the
    // margin buys nothing: an ancestor with `overflow-y: auto` clips the target first, so
    // a page below the fold never intersects however far the viewport rect is grown, and
    // every page would render only once it was already on screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { root: scrollParent(element), rootMargin: "600px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  return (
    <div ref={slot} className="w-full max-w-225">
      {!painted && <DocumentSkeleton />}

      {near && (
        <div className={painted ? undefined : "hidden"}>
          <Page
            pageNumber={pageNumber}
            width={width}
            onRenderSuccess={settle}
            // A page that refuses to draw must not leave its placeholder up for ever:
            // showing whatever react-pdf produced is the honest end of the wait, and the
            // document-level failure state covers the case where nothing drew at all.
            onRenderError={settle}
            // react-pdf's own slot never shows, because ours is still on screen.
            loading={null}
            className="overflow-hidden rounded-lg shadow-sm ring-1 ring-foreground/10"
          />
        </div>
      )}
    </div>
  );
}

/** The element a page is actually scrolled inside — the preview panel, in both the modal
 * and the file page. `null` means nothing scrolls above it and the viewport is the root. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * A page is rendered to a canvas at a fixed pixel width, so it has to be told how much
 * room it has — and told again when that changes, because the dialog is sized in
 * viewport units rather than at a breakpoint the CSS could react to.
 */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width;
      setWidth(Math.max(Math.min(available, MAX_PAGE_WIDTH), 0));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
