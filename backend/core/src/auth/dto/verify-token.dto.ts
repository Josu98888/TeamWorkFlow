import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Payload of `auth.token.verify`. The cap only bounds what is parsed; access
// tokens are well under 1 KiB.
export class VerifyTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  accessToken!: string;
}
