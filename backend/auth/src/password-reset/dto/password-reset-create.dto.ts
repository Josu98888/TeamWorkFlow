import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { ActorDto } from '../../common/dto/actor.dto';

// Payload of `auth.password-reset.create`. The tenant always comes from the
// actor; `userId` alone never selects a tenant.
export class CreatePasswordResetDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @IsUUID()
  userId!: string;
}
