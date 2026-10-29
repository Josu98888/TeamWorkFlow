export type AppErrorCode =
  | 'invalid_credentials'
  | 'invalid_token'
  | 'forbidden'
  | 'tenant_suspended'
  | 'tenant_cancelled'
  | 'email_taken'
  | 'site_not_found'
  | 'post_not_found'
  | 'employee_not_found'
  | 'shift_not_found'
  | 'shift_overlap'
  | 'version_conflict'
  | 'shift_not_editable'
  | 'validation_error';

export interface ValidationErrorItem {
  field: string;
  constraints: string[];
}

// Transport-agnostic error body. The HTTP filter maps it to `{ detail, code }`
// and the NATS filter sends it as-is to the caller.
export interface AppErrorBody {
  status: number;
  code: AppErrorCode;
  message: string;
  errors?: ValidationErrorItem[];
}

// Domain code throws this; it knows nothing about HTTP or NATS. It does not
// extend RpcException or HttpException on purpose.
export class AppException extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
    public readonly errors?: ValidationErrorItem[],
  ) {
    super(message);
    this.name = new.target.name;
  }

  getError(): AppErrorBody {
    const body: AppErrorBody = {
      status: this.status,
      code: this.code,
      message: this.message,
    };
    if (this.errors) {
      body.errors = this.errors;
    }
    return body;
  }
}

// Messages are fixed and generic: they are shown to end users and must not
// reveal whether an email exists, why a login failed, or any internal detail.

export class InvalidCredentialsException extends AppException {
  constructor() {
    super(401, 'invalid_credentials', 'Invalid credentials');
  }
}

export class InvalidTokenException extends AppException {
  constructor() {
    super(401, 'invalid_token', 'Invalid or expired token');
  }
}

export class ForbiddenException extends AppException {
  constructor() {
    super(403, 'forbidden', 'You are not allowed to perform this action');
  }
}

export class TenantSuspendedException extends AppException {
  constructor() {
    super(403, 'tenant_suspended', 'The organization account is suspended');
  }
}

export class TenantCancelledException extends AppException {
  constructor() {
    super(403, 'tenant_cancelled', 'The organization account is cancelled');
  }
}

export class EmailTakenException extends AppException {
  constructor() {
    super(409, 'email_taken', 'Email is already in use');
  }
}

export class SiteNotFoundException extends AppException {
  constructor() {
    super(404, 'site_not_found', 'Site not found');
  }
}

export class PostNotFoundException extends AppException {
  constructor() {
    super(404, 'post_not_found', 'Post not found');
  }
}

export class EmployeeNotFoundException extends AppException {
  constructor() {
    super(404, 'employee_not_found', 'Employee not found');
  }
}

export class ShiftNotFoundException extends AppException {
  constructor() {
    super(404, 'shift_not_found', 'Shift not found');
  }
}

export class ShiftOverlapException extends AppException {
  constructor() {
    super(
      409,
      'shift_overlap',
      'The employee already has an overlapping shift',
    );
  }
}

export class VersionConflictException extends AppException {
  constructor() {
    super(
      409,
      'version_conflict',
      'The resource was modified by someone else; reload and retry',
    );
  }
}

export class ShiftNotEditableException extends AppException {
  constructor() {
    super(
      409,
      'shift_not_editable',
      'A cancelled or finished shift cannot be edited',
    );
  }
}

export class ValidationException extends AppException {
  constructor(errors: ValidationErrorItem[]) {
    super(422, 'validation_error', 'Validation failed', errors);
  }
}
