import { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsString, ValidateNested } from 'class-validator';
import { ValidationException } from '../exceptions/app.exceptions';
import { createValidationPipe } from './validation.pipe';

class ProfileDto {
  @IsString()
  name!: string;
}

class SampleDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => ProfileDto)
  profile!: ProfileDto;
}

const metadata: ArgumentMetadata = { type: 'body', metatype: SampleDto };

async function validationErrorOf(value: unknown) {
  try {
    await createValidationPipe().transform(value, metadata);
  } catch (error) {
    return error as ValidationException;
  }
  throw new Error('Expected the pipe to reject the payload');
}

// Covers: S1.5
describe('validation pipe', () => {
  const valid = { email: 'a@b.com', profile: { name: 'Ana' } };

  it('returns a DTO instance for a valid payload', async () => {
    const result: unknown = await createValidationPipe().transform(
      valid,
      metadata,
    );

    expect(result).toBeInstanceOf(SampleDto);
  });

  it('rejects an unknown field with validation_error', async () => {
    const error = await validationErrorOf({ ...valid, role: 'OWNER' });

    expect(error).toBeInstanceOf(ValidationException);
    expect(error.getError()).toEqual(
      expect.objectContaining({
        status: 422,
        code: 'validation_error',
        errors: [
          expect.objectContaining({ field: 'role' }) as unknown,
        ] as unknown,
      }),
    );
  });

  it('rejects a missing required field with validation_error', async () => {
    const error = await validationErrorOf({ profile: { name: 'Ana' } });

    expect(error.getError()).toEqual(
      expect.objectContaining({
        status: 422,
        code: 'validation_error',
        errors: [expect.objectContaining({ field: 'email' }) as unknown],
      }),
    );
  });

  it('reports nested fields with their full path', async () => {
    const error = await validationErrorOf({
      email: 'a@b.com',
      profile: { name: 42 },
    });

    expect(error.getError()).toEqual(
      expect.objectContaining({
        errors: [expect.objectContaining({ field: 'profile.name' }) as unknown],
      }),
    );
  });
});
