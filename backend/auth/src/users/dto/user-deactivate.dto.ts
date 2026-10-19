import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { ActorDto } from '../../common/dto/actor.dto';

// Payload of `auth.user.deactivate`. The tenant always comes from the actor;
// `userId` alone never selects a tenant.
export class DeactivateUserDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsUUID()
  userId!: string;
}
