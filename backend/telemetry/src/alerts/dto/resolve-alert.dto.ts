import { IsOptional, IsString } from 'class-validator';

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
