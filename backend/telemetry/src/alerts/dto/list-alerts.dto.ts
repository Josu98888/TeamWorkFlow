import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export enum AlertStatusDto {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

export enum AlertTypeDto {
  LATE = 'late',
  UNCOVERED_POST = 'uncovered_post',
  OUT_OF_GEOFENCE = 'out_of_geofence',
  MISSING_CLOCK_OUT = 'missing_clock_out',
}

export class ListAlertsDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(AlertStatusDto)
  status?: AlertStatusDto;

  @IsOptional()
  @IsEnum(AlertTypeDto)
  type?: AlertTypeDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
