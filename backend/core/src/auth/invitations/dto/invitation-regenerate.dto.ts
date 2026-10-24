import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { ActorDto } from '../../dto/actor.dto';

// Payload of `auth.invitation.regenerate`. The tenant always comes from the
// actor; `invitationId` alone never selects a tenant.
export class RegenerateInvitationDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsUUID()
  invitationId!: string;
}
