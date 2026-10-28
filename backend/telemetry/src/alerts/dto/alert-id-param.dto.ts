import { IsUUID } from 'class-validator';

export class AlertIdParamDto {
  @IsUUID()
  alertId: string;
}
