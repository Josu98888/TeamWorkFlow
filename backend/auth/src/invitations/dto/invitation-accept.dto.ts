import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Payload of `auth.invitation.accept` (public: no actor). There is no role,
// tenant or email field: they all come from the stored invitation, and unknown
// fields are rejected by the global validation pipe.
export class AcceptInvitationDto {
  // Raw single-use token from the link. The upper bound keeps junk out of the hash.
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  // Not stored by auth: forwarded in the `user_created` event.
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  // Same rule as registration. The upper bound avoids feeding huge inputs to Argon2.
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
