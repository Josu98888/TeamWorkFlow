import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { ActorDto } from '../../common/dto/actor.dto';
import { CHANGEABLE_ROLES } from '../user-policy';
import type { ChangeableRole } from '../user-policy';

// Payload of `auth.user.change-role`. The target role is limited to admin,
// supervisor and employee: owner (one per tenant, no transfer) and
// platform_admin (seed/CLI only) are rejected by validation. The tenant
// always comes from the actor; `userId` alone never selects a tenant.
export class ChangeUserRoleDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsUUID()
  userId!: string;

  @IsIn(CHANGEABLE_ROLES)
  role!: ChangeableRole;
}
