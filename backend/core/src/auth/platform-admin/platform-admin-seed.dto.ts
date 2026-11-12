import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../common/email';

// Same email and password rules as `RegisterDto`, applied to what the operator
// types when seeding the platform admin.
export class PlatformAdminSeedEmail {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PlatformAdminSeedPassword {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
