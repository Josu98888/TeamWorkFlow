import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Payload of `auth.token.refresh`. Opaque tokens are 43 characters; the cap
// only bounds what is hashed.
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}
