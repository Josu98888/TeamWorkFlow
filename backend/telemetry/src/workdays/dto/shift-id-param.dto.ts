import { IsUUID } from 'class-validator';

export class ShiftIdParamDto {
  @IsUUID()
  shiftId: string;
}
