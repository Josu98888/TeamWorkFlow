import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const DECIMAL_RATE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export class UpsertEmployeeCompensationDto {
  @IsIn(['hourly', 'per_shift', 'HOURLY', 'PER_SHIFT'])
  payType!: 'hourly' | 'per_shift' | 'HOURLY' | 'PER_SHIFT';

  @IsString()
  @Matches(DECIMAL_RATE_PATTERN, {
    message: 'baseRate must be a non-negative decimal with up to 2 decimal places',
  })
  baseRate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class UpsertPostOvertimeRateDto {
  @IsString()
  @Matches(DECIMAL_RATE_PATTERN, {
    message:
      'overtimeHourlyRate must be a non-negative decimal with up to 2 decimal places',
  })
  overtimeHourlyRate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CompensationEmployeeIdParamDto {
  @IsUUID()
  employeeId!: string;
}

export class CompensationPostIdParamDto {
  @IsUUID()
  postId!: string;
}
