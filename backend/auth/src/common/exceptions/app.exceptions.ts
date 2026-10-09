import { RpcException } from '@nestjs/microservices';

export type AppErrorCode =
  | 'invalid_credentials'
  | 'invalid_token'
  | 'forbidden'
  | 'tenant_suspended'
  | 'tenant_cancelled'
  | 'email_taken'
  | 'validation_error';

export interface ValidationErrorItem {
  field: string;
  constraints: string[];
}

export interface AppRpcErrorBody {
  status: number;
  code: AppErrorCode;
  message: string;
  errors?: ValidationErrorItem[];
}

export class AppRpcException extends RpcException {
  constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
    errors?: ValidationErrorItem[],
  ) {
    // Passing an object to RpcException sends it as-is to the caller,
    // so the gateway can map `status` and `code` to HTTP.
    const body: AppRpcErrorBody = { status, code, message };
    if (errors) {
      body.errors = errors;
    }
    super(body);
  }
}

// Messages are fixed and generic: they are shown to end users and must not
// reveal whether an email exists, why a login failed, or any internal detail.

export class InvalidCredentialsException extends AppRpcException {
  constructor() {
    super(401, 'invalid_credentials', 'Invalid credentials');
  }
}

export class InvalidTokenException extends AppRpcException {
  constructor() {
    super(401, 'invalid_token', 'Invalid or expired token');
  }
}

export class ForbiddenException extends AppRpcException {
  constructor() {
    super(403, 'forbidden', 'You are not allowed to perform this action');
  }
}

export class TenantSuspendedException extends AppRpcException {
  constructor() {
    super(403, 'tenant_suspended', 'The organization account is suspended');
  }
}

export class TenantCancelledException extends AppRpcException {
  constructor() {
    super(403, 'tenant_cancelled', 'The organization account is cancelled');
  }
}

export class EmailTakenException extends AppRpcException {
  constructor() {
    super(409, 'email_taken', 'Email is already in use');
  }
}

export class ValidationException extends AppRpcException {
  constructor(errors: ValidationErrorItem[]) {
    super(422, 'validation_error', 'Validation failed', errors);
  }
}
