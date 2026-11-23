import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../sites/dto/site.dto';

export const MIN_TEMPLATE_DURATION_MINUTES = 1;
export const MAX_TEMPLATE_DURATION_MINUTES = 1440;
export const SHIFT_TEMPLATE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const PRESENT = (_: unknown, value: unknown) => value !== undefined;

// HTTP body of `POST /shift-templates`. `tenantId` comes from the actor.
export class CreateShiftTemplateBodyDto {
  @IsUUID()
  siteId!: string;

  @IsUUID()
  postId!: string;

  // ISO weekdays 1 (Monday) .. 7 (Sunday).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays!: number[];

  // 24h wall-clock HH:mm in the site's IANA timezone.
  @IsString()
  @Matches(SHIFT_TEMPLATE_TIME_PATTERN)
  startTime!: string;

  @IsInt()
  @Min(MIN_TEMPLATE_DURATION_MINUTES)
  @Max(MAX_TEMPLATE_DURATION_MINUTES)
  durationMinutes!: number;

  @IsOptional()
  @IsUUID()
  employeeId?: string | null;
}

// HTTP body of `PATCH /shift-templates/:templateId`.
export class UpdateShiftTemplateBodyDto {
  @ValidateIf(PRESENT)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @ValidateIf(PRESENT)
  @IsString()
  @Matches(SHIFT_TEMPLATE_TIME_PATTERN)
  startTime?: string;

  @ValidateIf(PRESENT)
  @IsInt()
  @Min(MIN_TEMPLATE_DURATION_MINUTES)
  @Max(MAX_TEMPLATE_DURATION_MINUTES)
  durationMinutes?: number;

  // Optional nullable field so `{ employeeId: null }` unassigns the template.
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @ValidateIf(PRESENT)
  @IsBoolean()
  isActive?: boolean;
}

export class ShiftTemplateIdParamDto {
  @IsUUID()
  templateId!: string;
}

// Query of `GET /shift-templates`.
export class ListShiftTemplatesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
