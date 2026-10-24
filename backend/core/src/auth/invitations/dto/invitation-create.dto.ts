import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { normalizeEmail } from '../../../common/email';
import { ActorDto } from '../../dto/actor.dto';
import { WIRE_INVITATION_ROLES } from '../../wire';
import type { WireInvitationRole } from '../../wire';

// HTTP body of `POST /auth/invitations`. Only admin, supervisor and employee
// can be invited; owner and platform_admin are rejected by validation. It has
// no actor: the controller adds the verified one.
export class CreateInvitationBodyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(WIRE_INVITATION_ROLES)
  role!: WireInvitationRole;
}

// Input of `auth.invitation.create`.
export class CreateInvitationDto extends CreateInvitationBodyDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;
}
