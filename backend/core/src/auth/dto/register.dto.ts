import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeEmail } from '../../common/email';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Payload of `auth.register`. There is no role or tenant field: the new user
// is always the OWNER of a new tenant, and unknown fields are rejected by the
// global validation pipe (`forbidNonWhitelisted`).
export class RegisterDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  tenantName!: string;

  // Not stored by auth: forwarded in the `user_created` event.
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Upper bound avoids feeding huge inputs to Argon2.
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
