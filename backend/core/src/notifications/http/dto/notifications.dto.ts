import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const UUID_OR_ALL_REGEX =
  /^(all|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export class RegisterPushTokenBodyDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}

export class UnregisterPushTokenBodyDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  unreadOnly?: boolean;
}

export class MarkReadParamDto {
  @IsString()
  @Matches(UUID_OR_ALL_REGEX, {
    message: 'id must be a valid UUID or "all"',
  })
  id!: string;
}

export class MarkReadBodyDto {
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
