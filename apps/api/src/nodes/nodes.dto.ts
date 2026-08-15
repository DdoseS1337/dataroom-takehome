import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { ConflictPolicy } from '../files/files.dto';
import { NodeName } from './node-name';

export class CreateRoomDto {
  @NodeName()
  name!: string;
}

export class UpdateRoomDto {
  @NodeName()
  name!: string;
}

/**
 * Rename, move, or both. Both optional at the DTO level because either alone is a valid
 * request; the service refuses the empty one, which is the only combination class
 * validators cannot express.
 */
export class UpdateNodeDto {
  @IsOptional()
  @NodeName()
  name?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  /**
   * The user's answer to a name clash in the destination, carried on the second attempt
   * — the same shape `/files/init` uses. It applies to a move only: a rename blocks with
   * an inline suggestion instead, deliberately, because renaming is one deliberate act on
   * one item and a dialog there would be a dialog asking the question the field already
   * asked. See docs/data-model.md.
   */
  @IsOptional()
  @IsIn(['error', 'keepBoth', 'replace'])
  onConflict?: ConflictPolicy;
}

export class CreateFolderDto {
  @IsUUID()
  parentId!: string;

  @NodeName()
  name!: string;
}

/**
 * `scope` is an addition to the frozen contract, raised before it was written.
 *
 * `GET /search?q=` alone means "search everything", which forces the permission decision
 * down to the row — every hit's ancestor chain resolved separately. A scope node moves it
 * back where it belongs: authorised once, then a prefix scan that cannot leave the
 * subtree. It is required rather than optional so there is no unbounded branch to
 * accidentally fall into.
 */
export class SearchQuery {
  @IsString()
  @MaxLength(255)
  q!: string;

  @IsUUID()
  scope!: string;
}

export class ListChildrenQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
