import { IsIn, IsUUID, ValidateIf } from 'class-validator';
import { WIRE_ROLES } from '../wire';
import type { WireRole } from '../wire';

// The authenticated caller, as the gateway took it from `auth.token.verify`
// (AGENTS NATS Contract: "actor"). `tenantId` is null for platform_admin.
export class ActorDto {
  @IsUUID()
  userId!: string;

  // null is allowed; undefined or a non-uuid value is not.
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  tenantId!: string | null;

  @IsIn(WIRE_ROLES)
  role!: WireRole;
}
