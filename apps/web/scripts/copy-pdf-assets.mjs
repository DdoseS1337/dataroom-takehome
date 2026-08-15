// pdf.js needs four things at runtime that are not part of the JS bundle: its worker,
// the CMap tables, the base-14 font programs, and the WASM image decoders. It fetches
// them by URL, so they have to be served — and the alternative, pointing them at a CDN,
// makes a document that renders correctly depend on a third-party host being up.
//
// Copied at build time rather than committed: they are 2 MB of generated files that
// belong to a pinned dependency, and vendoring them into git means they silently go
// stale the next time pdfjs-dist moves.
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjs = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(import.meta.dirname, "..", "public", "pdf");

await mkdir(target, { recursive: true });

await Promise.all([
  cp(join(pdfjs, "build", "pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs")),
  cp(join(pdfjs, "cmaps"), join(target, "cmaps"), { recursive: true }),
  cp(join(pdfjs, "standard_fonts"), join(target, "standard_fonts"), {
    recursive: true,
  }),
  cp(join(pdfjs, "wasm"), join(target, "wasm"), { recursive: true }),
]);
