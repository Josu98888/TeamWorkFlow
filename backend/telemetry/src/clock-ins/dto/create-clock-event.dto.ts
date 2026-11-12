import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum ClockEventTypeDto {
  IN = 'in',
  OUT = 'out',
  BREAK_START = 'break_start',
  BREAK_END = 'break_end',
}

export enum ClockEventMethodDto {
  GPS = 'gps',
  QR = 'qr',
}

export class CreateClockEventDto {
  @IsString()
  @IsNotEmpty()
  clientEventId: string;

  @IsEnum(ClockEventTypeDto)
  type: ClockEventTypeDto;

  @IsEnum(ClockEventMethodDto)
  method: ClockEventMethodDto;

  @IsUUID()
  siteId: string;

  @IsISO8601()
  deviceTime: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  qrCode?: string;
}
