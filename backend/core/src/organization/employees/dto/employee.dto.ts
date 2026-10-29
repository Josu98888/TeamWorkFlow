import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../sites/dto/site.dto';

export const MAX_ENABLED_SITES = 200;
export const MAX_WEEKLY_HOURS_LIMIT = 168;

// Nullable columns use `@IsOptional()` (it also lets `null` through, which
// clears the value on update). Required columns on update use
// `@ValidateIf(value !== undefined)` so `null` is rejected.
const PRESENT = (_: unknown, value: unknown) => value !== undefined;

// HTTP body of `POST /employees`. The tenant comes from the actor. The email is
// normalized (trimmed, lowercased) by the service.
export class CreateEmployeeBodyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsUUID()
  avatarMediaId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  employeeNumber?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  nationalId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_WEEKLY_HOURS_LIMIT)
  weeklyHoursLimit?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENABLED_SITES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  siteIds?: string[];
}

// HTTP body of `PATCH /employees/:employeeId`. The email is not editable here
// (`auth` links the user by email). `siteIds` replaces the whole set.
export class UpdateEmployeeBodyDto {
  @ValidateIf(PRESENT)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ValidateIf(PRESENT)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsUUID()
  avatarMediaId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  employeeNumber?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  nationalId?: string | null;

  @ValidateIf(PRESENT)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_WEEKLY_HOURS_LIMIT)
  weeklyHoursLimit?: number | null;

  @ValidateIf(PRESENT)
  @IsArray()
  @ArrayMaxSize(MAX_ENABLED_SITES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  siteIds?: string[];

  @ValidateIf(PRESENT)
  @IsBoolean()
  isActive?: boolean;
}

export class EmployeeIdParamDto {
  @IsUUID()
  employeeId!: string;
}

// Query of `GET /employees`.
export class ListEmployeesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;

  // Matches first name, last name or email (case-insensitive, contains).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  search?: string;
}
