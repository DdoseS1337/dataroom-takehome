import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotIn, IsString, Length, Matches } from 'class-validator';

export const MAX_NAME_LENGTH = 200;

// Path separators would make a name unreadable next to the breadcrumb trail; control
// characters let one name render identically to another in a list. Matching them is
// the whole point, so the control-character rule is off for this line.
// eslint-disable-next-line no-control-regex
const ALLOWED_CHARACTERS = /^[^/\\\u0000-\u001F\u007F]+$/u;

/**
 * Names arrive normalised to Unicode NFC, because `nodes_name_uniq` compares stored
 * bytes: without this, two spellings of `é` coexist as siblings that look identical
 * and a reviewer opens the wrong document.
 *
 * Trimming happens here rather than in the database, so the name checked for a
 * conflict is exactly the name that gets stored.
 */
function toNfc(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export function NodeName(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => toNfc(value)),
    IsString(),
    Length(1, MAX_NAME_LENGTH, {
      message: `A name must be between 1 and ${MAX_NAME_LENGTH} characters.`,
    }),
    Matches(ALLOWED_CHARACTERS, {
      message: 'A name cannot contain slashes or control characters.',
    }),
    IsNotIn(['.', '..'], { message: 'That name is reserved.' }),
  );
}

/**
 * The next name to try when "Keep both" resolves a conflict: `MSA.pdf` becomes
 * `MSA (2).pdf`, and `MSA (2).pdf` becomes `MSA (3).pdf`.
 *
 * This is the retry-loop version — it looks at nothing but the name it is given, which
 * is what makes it safe under concurrency: two clients racing for one name both collide
 * again and both move on. For the name *suggested* to a user, see `candidateNames`.
 */
export function nextCandidateName(name: string): string {
  const { base, extension } = splitNumbered(name);
  const numbered = /^(.*) \((\d+)\)$/.exec(splitExtension(name).stem);
  return numberedName(base, extension, numbered ? Number(numbered[2]) + 1 : 2);
}

/**
 * The names worth offering as an alternative, in the order a person would try them:
 * `Report (2)`, `Report (3)`, and so on. An already-numbered name restarts from 2 rather
 * than counting up from where it happens to be, because the gaps matter — with `Report`
 * and `Report (3)` taken, `Report (2)` is the obvious free slot and counting from 3
 * would skip it.
 *
 * The caller asks the database which of these are taken and offers the first that is
 * not. That lookup happens only after a `23505` has already fired, so it is not the
 * pre-check the unique index exists to replace: the index still decides who gets the
 * name, and a suggestion that goes stale in the meantime simply collides and offers the
 * next one.
 */
export function candidateNames(name: string, count: number): string[] {
  const { base, extension } = splitNumbered(name);
  return Array.from({ length: count }, (_, index) =>
    numberedName(base, extension, index + 2),
  );
}

/**
 * The first candidate nobody holds. `taken` carries lowercased names, because that is
 * what `nodes_name_uniq` and `data_rooms_name_uniq` compare — suggesting `Report (2)`
 * when `report (2)` exists would be refused for a reason invisible on screen.
 */
export function firstFree(
  candidates: string[],
  taken: Set<string>,
): string | null {
  return candidates.find((name) => !taken.has(name.toLowerCase())) ?? null;
}

function splitNumbered(name: string): { base: string; extension: string } {
  const { stem, extension } = splitExtension(name);
  const numbered = /^(.*) \((\d+)\)$/.exec(stem);
  return { base: numbered ? numbered[1] : stem, extension };
}

/**
 * The counter goes before the extension, not after the whole name. `MSA.pdf (2)` would
 * still open in a PDF reader on most systems, but it sorts away from its siblings and
 * reads as a broken filename to anyone scanning the folder.
 */
function numberedName(
  base: string,
  extension: string,
  ordinal: number,
): string {
  const suffix = ` (${ordinal})${extension}`;
  // Numbering lengthens the name, so an already-long one would grow past the column
  // bound and fail for a reason the user cannot do anything about.
  const room = Math.max(MAX_NAME_LENGTH - suffix.length, 0);
  return `${base.length > room ? base.slice(0, room).trimEnd() : base}${suffix}`;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' };

  const extension = name.slice(dot);
  // Anything longer or containing a space is part of the name rather than a suffix —
  // `Q1 2024. Final` must not be treated as a file with a ` Final` extension.
  if (extension.length > 11 || extension.includes(' ')) {
    return { stem: name, extension: '' };
  }
  return { stem: name.slice(0, dot), extension };
}
