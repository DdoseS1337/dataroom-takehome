import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { NodeName } from '../nodes/node-name';

/**
 * How a name collision at `/files/init` should be resolved. The first attempt for any
 * file is `error`, which is what opens the conflict dialog; the other two arrive on the
 * second attempt, carrying the user's answer.
 *
 * The policy is applied server-side rather than by the client renaming and retrying:
 * two uploads racing for the same name would both compute the same "(2)" suffix, and
 * the second would come back to the user as a conflict on a name they never typed.
 */
export type ConflictPolicy = 'error' | 'keepBoth' | 'replace';

export class InitUploadDto {
  @IsUUID()
  parentId!: string;

  @NodeName()
  name!: string;

  /**
   * Declared by the browser, so it is a courtesy check that saves an oversized transfer
   * — not the authority. The stored object's real size is read back in `/complete`.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes!: number;

  @IsOptional()
  @IsIn(['error', 'keepBoth', 'replace'])
  onConflict?: ConflictPolicy;
}

/**
 * The version this caller reserved at `init`, not "whatever is in flight on that node".
 * Two replacements of one file can overlap, and each request must verify its own bytes
 * — otherwise one deletes the other's object and both report the wrong outcome.
 */
export class CompleteUploadDto {
  @IsUUID()
  versionId!: string;
}

export class CancelUploadQuery {
  @IsOptional()
  @IsUUID()
  versionId?: string;
}
