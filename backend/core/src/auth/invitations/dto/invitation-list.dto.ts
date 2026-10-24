import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { ActorDto } from '../../dto/actor.dto';

// Payload of `auth.invitation.list`: only the actor; the tenant filter always
// comes from it.
export class ListInvitationsDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;
}
