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
