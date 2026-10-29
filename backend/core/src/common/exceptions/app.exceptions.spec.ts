import { RpcException } from '@nestjs/microservices';
import { HttpException } from '@nestjs/common';
import {
  AppException,
  EmailTakenException,
  EmployeeNotFoundException,
  ForbiddenException,
  InvalidCredentialsException,
  InvalidTokenException,
  ShiftNotEditableException,
  ShiftNotFoundException,
  ShiftOverlapException,
  TenantCancelledException,
  TenantSuspendedException,
  ValidationException,
  VersionConflictException,
} from './app.exceptions';

describe('app.exceptions', () => {
  it.each([
    [new InvalidCredentialsException(), 401, 'invalid_credentials'],
    [new InvalidTokenException(), 401, 'invalid_token'],
    [new ForbiddenException(), 403, 'forbidden'],
    [new TenantSuspendedException(), 403, 'tenant_suspended'],
    [new TenantCancelledException(), 403, 'tenant_cancelled'],
    [new EmailTakenException(), 409, 'email_taken'],
    [new EmployeeNotFoundException(), 404, 'employee_not_found'],
    [new ShiftNotFoundException(), 404, 'shift_not_found'],
    [new ShiftOverlapException(), 409, 'shift_overlap'],
    [new VersionConflictException(), 409, 'version_conflict'],
    [new ShiftNotEditableException(), 409, 'shift_not_editable'],
    [new ValidationException([]), 422, 'validation_error'],
  ])(
    '%p carries status %i and code %s',
    (exception: AppException, status: number, code: string) => {
      expect(exception).toBeInstanceOf(AppException);
      expect(exception).toBeInstanceOf(Error);
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

  it('is transport-agnostic: not an RpcException nor an HttpException', () => {
    const exception = new ForbiddenException();

    expect(exception).not.toBeInstanceOf(RpcException);
    expect(exception).not.toBeInstanceOf(HttpException);
  });

  it('uses the class name as the error name', () => {
    expect(new EmailTakenException().name).toBe('EmailTakenException');
  });

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
