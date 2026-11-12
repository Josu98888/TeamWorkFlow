import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';
import { ClockEventTypeDto } from './create-clock-event.dto';

export class CreateManualClockEventDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  shiftId: string;

  @IsEnum(ClockEventTypeDto)
  type: ClockEventTypeDto;

  @IsISO8601()
  time: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
