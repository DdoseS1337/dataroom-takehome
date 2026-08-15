"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Skeleton } from "@/components/ui/skeleton";

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
}: {
  url: string;
  onFailed: () => void;
}) {
  const [pageCount, setPageCount] = useState(0);
  const { ref, width } = useMeasuredWidth();

  return (
    <div ref={ref} className="flex flex-col items-center gap-4 p-4">
      <Document
        file={url}
        options={DOCUMENT_OPTIONS}
        onLoadSuccess={({ numPages }) => setPageCount(numPages)}
        onLoadError={onFailed}
        onSourceError={onFailed}
        // The dialog owns the failure state, so react-pdf's own error slot never needs
        // to say anything — leaving the skeleton up until it does.
        loading={<PageSkeleton />}
        error={<PageSkeleton />}
        className="flex w-full flex-col items-center gap-4"
      >
        {width > 0 &&
          Array.from({ length: pageCount }, (_, index) => (
            <Page
              key={index}
              pageNumber={index + 1}
              width={width}
              loading={<PageSkeleton />}
              className="overflow-hidden rounded-lg shadow-sm ring-1 ring-foreground/10"
            />
          ))}
      </Document>
    </div>
  );
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

/** A page-shaped placeholder, not a centred spinner — see docs/ui.md. A4 is 1:1.414. */
function PageSkeleton() {
  return (
    <Skeleton className="aspect-[1/1.414] w-full max-w-225 rounded-lg" />
  );
}
