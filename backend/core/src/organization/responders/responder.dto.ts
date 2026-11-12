import { IsUUID } from 'class-validator';

// Payloads of the NATS responders `telemetry` calls. They carry an explicit
// `tenantId` and no actor (background-style call, trusted internal network).
// Extra properties are rejected by the validation pipe.
export class SiteGetRequestDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  siteId!: string;
}

// `telemetry` looks the employee up by the actor `userId` only.
export class EmployeeGetRequestDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  userId!: string;
}

export class ShiftGetRequestDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  shiftId!: string;
}
