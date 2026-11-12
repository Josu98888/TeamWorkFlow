import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

// Payload of `auth.password-reset.confirm` (public: no actor). The user comes
// from the stored token, never from the payload; unknown fields are rejected
// by the global validation pipe.
export class ConfirmPasswordResetDto {
  // Raw single-use token from the link. The upper bound keeps junk out of the hash.
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  // Same rule as registration and invitation acceptance. The upper bound
  // avoids feeding huge inputs to Argon2.
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
