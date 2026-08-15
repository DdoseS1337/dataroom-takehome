/**
 * A minimal PDF writer, used by the seed and by nothing else.
 *
 * The demo needs documents that open to something a reader recognises as a document. The
 * two obvious ways to get them are both worse than this one: committing real PDFs puts tens
 * of megabytes of binary in a repository a reviewer has to clone, and emitting a valid but
 * empty page makes every file in the data room open onto a blank sheet, which reads as a
 * broken viewer rather than as an empty document.
 *
 * So this writes the smallest PDF that carries flowing text: a catalog, a page tree, one
 * content stream per page, and the two base-14 fonts every reader is required to have, so
 * nothing has to be embedded. Around 2 KB per page.
 *
 * The cross-reference table holds byte offsets, which is the whole reason the file is
 * assembled as a list of buffers with a running total rather than as one template string.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const MARGIN = 64;
const TITLE_SIZE = 16;
const REFERENCE_SIZE = 8.5;
const BODY_SIZE = 10.5;
const FOOTER_SIZE = 8;
const LEADING = 14;

const TITLE_BASELINE = PAGE_HEIGHT - 80;
const REFERENCE_BASELINE = PAGE_HEIGHT - 98;
/** Lower on the first page, which gives up its top to the title block. */
const BODY_TOP_FIRST = PAGE_HEIGHT - 136;
const BODY_TOP = PAGE_HEIGHT - 80;
const BODY_BOTTOM = 96;
const FOOTER_BASELINE = 56;

/**
 * Helvetica's lowercase letters average a little under half the point size, so 84 columns
 * at 10.5pt sits inside the 467pt measure with room for a line of unusually wide characters.
 * Wrapping by column count rather than by measured width keeps this file to one job.
 */
const WRAP_COLUMNS = 84;

export interface PdfSection {
  heading: string;
  paragraphs: string[];
}

export interface PdfDocument {
  title: string;
  /** The line under the title — a document reference, a date, a status. */
  reference: string;
  sections: PdfSection[];
}

interface Line {
  text: string;
  bold: boolean;
}

export function buildPdf(document: PdfDocument): Buffer {
  const pages = paginate(flow(document));
  const objects: string[] = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pages
      .map((_, index) => `${pageObjectNumber(index)} 0 R`)
      .join(' ')}] /Count ${pages.length} >>`,
  );
  objects.push(font('Helvetica'));
  objects.push(font('Helvetica-Bold'));

  pages.forEach((lines, index) => {
    const stream = content(document, lines, index, pages.length);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]` +
        ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>` +
        ` /Contents ${pageObjectNumber(index) + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  return assemble(objects);
}

/** Page objects start after the catalog, the page tree and the two fonts, two per page. */
function pageObjectNumber(index: number): number {
  return 5 + index * 2;
}

function font(baseFont: string): string {
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /Encoding /WinAnsiEncoding >>`;
}

/** The document as a single stream of laid-out lines, before it is cut into pages. */
function flow(document: PdfDocument): Line[] {
  const lines: Line[] = [];

  for (const section of document.sections) {
    if (lines.length > 0) lines.push({ text: '', bold: false });
    lines.push({ text: section.heading, bold: true });
    lines.push({ text: '', bold: false });

    section.paragraphs.forEach((paragraph, index) => {
      if (index > 0) lines.push({ text: '', bold: false });
      for (const text of wrap(paragraph)) lines.push({ text, bold: false });
    });
  }

  return lines;
}

function wrap(paragraph: string): string[] {
  const lines: string[] = [];
  let line = '';

  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= WRAP_COLUMNS) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line.length > 0) lines.push(line);
  return lines;
}

function paginate(lines: Line[]): Line[][] {
  const first = Math.floor((BODY_TOP_FIRST - BODY_BOTTOM) / LEADING) + 1;
  const rest = Math.floor((BODY_TOP - BODY_BOTTOM) / LEADING) + 1;

  const pages: Line[][] = [];
  let remaining = [...lines];

  while (remaining.length > 0) {
    const capacity = pages.length === 0 ? first : rest;
    const page = remaining.slice(0, capacity);
    remaining = remaining.slice(capacity);

    // A blank line that lands at the top of a page is the gap above a heading that has
    // just moved to the next page, so it has nothing left to separate.
    while (page.length > 0 && page[0].text === '') page.shift();
    if (page.length > 0) pages.push(page);
  }

  return pages.length > 0 ? pages : [[]];
}

function content(
  document: PdfDocument,
  lines: Line[],
  index: number,
  total: number,
): string {
  const parts: string[] = [];

  if (index === 0) {
    parts.push(
      text(
        `/F2 ${TITLE_SIZE} Tf ${MARGIN} ${TITLE_BASELINE} Td ${string(document.title)} Tj`,
      ),
      text(
        `/F1 ${REFERENCE_SIZE} Tf ${MARGIN} ${REFERENCE_BASELINE} Td ${string(document.reference)} Tj`,
      ),
      // A rule under the title block, the one non-text mark in the file.
      `0.75 w 0.6 0.6 0.6 RG ${MARGIN} ${REFERENCE_BASELINE - 12} m ${PAGE_WIDTH - MARGIN} ${REFERENCE_BASELINE - 12} l S`,
    );
  }

  const top = index === 0 ? BODY_TOP_FIRST : BODY_TOP;
  const body = lines
    .map(
      (line) =>
        `/F${line.bold ? 2 : 1} ${BODY_SIZE} Tf ${string(line.text)} Tj T*`,
    )
    .join('\n');

  parts.push(text(`${LEADING} TL ${MARGIN} ${top} Td\n${body}`));
  parts.push(
    text(
      `/F1 ${FOOTER_SIZE} Tf 0.45 0.45 0.45 rg ${MARGIN} ${FOOTER_BASELINE} Td ` +
        `${string(`${document.reference} | Confidential | Page ${index + 1} of ${total}`)} Tj`,
    ),
  );

  return parts.join('\n');
}

function text(body: string): string {
  return `BT\n${body}\nET`;
}

/** A PDF literal string. Only these three characters change meaning inside one. */
function string(value: string): string {
  return `(${value.replace(/([\\()])/g, '\\$1')})`;
}

/**
 * Objects into a file. Offsets are counted in bytes as the parts are appended, because the
 * cross-reference table is a table of byte offsets and a character count would be wrong the
 * moment a document contained anything outside ASCII.
 */
function assemble(objects: string[]): Buffer {
  // The binary comment on the second line is what marks the file as binary rather than
  // text, so a transport that would otherwise rewrite line endings leaves it alone.
  const parts: Buffer[] = [
    Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1'),
  ];
  const offsets: number[] = [];
  let offset = parts[0].length;

  objects.forEach((body, index) => {
    const part = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    offsets.push(offset);
    offset += part.length;
    parts.push(part);
  });

  const table = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(offset),
    '%%EOF',
  ].join('\n');

  parts.push(Buffer.from(`${table}\n`, 'latin1'));
  return Buffer.concat(parts);
}
