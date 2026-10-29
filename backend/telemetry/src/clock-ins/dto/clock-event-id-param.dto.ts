import { IsUUID } from 'class-validator';

export class ClockEventIdParamDto {
  @IsUUID()
  clockEventId: string;
}
