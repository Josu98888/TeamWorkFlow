import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ActorDto } from '../../common/dto/actor.dto';
import { normalizeEmail } from '../../common/email';
import { WIRE_INVITATION_ROLES } from '../../common/wire';
import type { WireInvitationRole } from '../../common/wire';

// Payload of `auth.invitation.create`. Only admin, supervisor and employee can
// be invited; owner and platform_admin are rejected by validation.
export class CreateInvitationDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(WIRE_INVITATION_ROLES)
  role!: WireInvitationRole;
}
