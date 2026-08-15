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
 * The next name to try when "Keep both" resolves an upload conflict: `MSA.pdf` becomes
 * `MSA (2).pdf`, and `MSA (2).pdf` becomes `MSA (3).pdf`.
 *
 * The counter goes before the extension, not after the whole name. `MSA.pdf (2)` would
 * still open in a PDF reader on most systems, but it sorts away from its siblings and
 * reads as a broken filename to anyone scanning the folder.
 */
export function nextCandidateName(name: string): string {
  const { stem, extension } = splitExtension(name);
  const numbered = /^(.*) \((\d+)\)$/.exec(stem);
  const base = numbered ? numbered[1] : stem;
  const suffix = ` (${numbered ? Number(numbered[2]) + 1 : 2})${extension}`;

  // Every attempt lengthens the name, so an already-long one would grow past the column
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
