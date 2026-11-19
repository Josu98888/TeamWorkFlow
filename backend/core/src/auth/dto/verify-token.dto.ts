import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// What a token may be used for. `access` (the default) is the session token of
// HTTP routes and never carries a `typ` claim; `socket` is the short-lived
// token of the Torre de Control WebSocket (`typ: 'socket'`). Verification is
// purpose-aware so one kind can never stand in for the other.
export const TOKEN_PURPOSES = ['access', 'socket'] as const;
// Value of the `typ` claim that marks a socket token.
export const SOCKET_TOKEN_TYP = 'socket';
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

// Payload of `auth.token.verify`. The cap only bounds what is parsed; access
// tokens are well under 1 KiB.
export class VerifyTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  accessToken!: string;

  @IsOptional()
  @IsIn(TOKEN_PURPOSES)
  purpose?: TokenPurpose;
}
