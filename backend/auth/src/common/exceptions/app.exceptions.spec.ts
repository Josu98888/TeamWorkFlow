import { RpcException } from '@nestjs/microservices';
import {
  AppRpcException,
  EmailTakenException,
  ForbiddenException,
  InvalidCredentialsException,
  InvalidTokenException,
  TenantCancelledException,
  TenantSuspendedException,
  ValidationException,
} from './app.exceptions';

// Covers: S1.4
describe('app.exceptions', () => {
  it.each([
    [new InvalidCredentialsException(), 401, 'invalid_credentials'],
    [new InvalidTokenException(), 401, 'invalid_token'],
    [new ForbiddenException(), 403, 'forbidden'],
    [new TenantSuspendedException(), 403, 'tenant_suspended'],
    [new TenantCancelledException(), 403, 'tenant_cancelled'],
    [new EmailTakenException(), 409, 'email_taken'],
    [new ValidationException([]), 422, 'validation_error'],
  ])(
    '%p sends status %i and code %s to the caller',
    (exception: AppRpcException, status: number, code: string) => {
      expect(exception).toBeInstanceOf(RpcException);
      expect(exception.status).toBe(status);
      expect(exception.code).toBe(code);
      expect(exception.getError()).toEqual(
        expect.objectContaining({
          status,
          code,
          message: expect.any(String) as string,
        }),
      );
    },
  );

  it('includes the field errors only in validation_error', () => {
    const errors = [
      { field: 'email', constraints: ['email must be an email'] },
    ];

    expect(new ValidationException(errors).getError()).toEqual({
      status: 422,
      code: 'validation_error',
      message: 'Validation failed',
      errors,
    });
    expect(new ForbiddenException().getError()).not.toHaveProperty('errors');
  });
});
