import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ClockEventTypeDto } from './create-clock-event.dto';

export class CorrectClockEventDto {
  @IsOptional()
  @IsEnum(ClockEventTypeDto)
  type?: ClockEventTypeDto;

  @IsOptional()
  @IsISO8601()
  time?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
