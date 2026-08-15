import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { NodeName } from './node-name';

export class CreateRoomDto {
  @NodeName()
  name!: string;
}

export class CreateFolderDto {
  @IsUUID()
  parentId!: string;

  @NodeName()
  name!: string;
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
