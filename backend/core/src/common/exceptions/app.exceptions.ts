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
  | 'validation_error'
  | 'subscription_not_found'
  | 'invoice_not_found'
  | 'plan_not_found'
  | 'invalid_subscription_transition'
  | 'invalid_plan_change'
  | 'no_pending_cancellation'
  | 'invoice_not_payable'
  | 'invoice_exists'
  | 'invalid_webhook_signature'
  | 'payment_provider_error'
  | 'feature_not_in_plan'
  | 'form_not_found'
  | 'task_not_found'
  | 'media_not_found'
  | 'form_not_published'
  | 'task_not_open'
  | 'task_already_claimed'
  | 'no_shift_in_progress'
  | 'qr_mismatch'
  | 'answer_too_old'
  | 'media_too_large'
  | 'media_type_not_allowed'
  | 'media_not_uploaded'
  | 'notification_not_found'
  | 'invalid_push_token';

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

export class SubscriptionNotFoundException extends AppException {
  constructor() {
    super(404, 'subscription_not_found', 'Subscription not found');
  }
}

export class InvoiceNotFoundException extends AppException {
  constructor() {
    super(404, 'invoice_not_found', 'Invoice not found');
  }
}

export class PlanNotFoundException extends AppException {
  constructor() {
    super(404, 'plan_not_found', 'Plan not found');
  }
}

export class InvalidSubscriptionTransitionException extends AppException {
  constructor() {
    super(
      409,
      'invalid_subscription_transition',
      'Invalid subscription state transition',
    );
  }
}

export class InvalidPlanChangeException extends AppException {
  constructor() {
    super(409, 'invalid_plan_change', 'Invalid plan change request');
  }
}

export class NoPendingCancellationException extends AppException {
  constructor() {
    super(409, 'no_pending_cancellation', 'No pending cancellation to undo');
  }
}

export class InvoiceNotPayableException extends AppException {
  constructor() {
    super(
      409,
      'invoice_not_payable',
      'The invoice is paid or void and cannot be paid',
    );
  }
}

export class InvoiceExistsException extends AppException {
  constructor() {
    super(
      409,
      'invoice_exists',
      'An invoice already exists for this tenant and period',
    );
  }
}

export class InvalidWebhookSignatureException extends AppException {
  constructor() {
    super(401, 'invalid_webhook_signature', 'Invalid webhook signature');
  }
}

export class PaymentProviderErrorException extends AppException {
  constructor(message = 'Payment provider communication error') {
    super(502, 'payment_provider_error', message);
  }
}

export class FeatureNotInPlanException extends AppException {
  constructor() {
    super(403, 'feature_not_in_plan', 'Feature not included in current plan');
  }
}

export class FormNotFoundException extends AppException {
  constructor() {
    super(404, 'form_not_found', 'Form not found');
  }
}

export class TaskNotFoundException extends AppException {
  constructor() {
    super(404, 'task_not_found', 'Task not found');
  }
}

export class MediaNotFoundException extends AppException {
  constructor() {
    super(404, 'media_not_found', 'Media not found');
  }
}

export class FormNotPublishedException extends AppException {
  constructor() {
    super(409, 'form_not_published', 'Form version is not published');
  }
}

export class TaskNotOpenException extends AppException {
  constructor() {
    super(409, 'task_not_open', 'Task is not open for answering or claiming');
  }
}

export class TaskAlreadyClaimedException extends AppException {
  constructor() {
    super(
      409,
      'task_already_claimed',
      'Task has already been claimed by another employee',
    );
  }
}

export class NoShiftInProgressException extends AppException {
  constructor() {
    super(
      403,
      'no_shift_in_progress',
      'Employee does not have a shift in progress at this site and post',
    );
  }
}

export class QrMismatchException extends AppException {
  constructor() {
    super(422, 'qr_mismatch', 'Scanned QR code does not match expected QR');
  }
}

export class AnswerTooOldException extends AppException {
  constructor() {
    super(422, 'answer_too_old', 'Offline answer timestamp is older than 24 hours');
  }
}

export class MediaTooLargeException extends AppException {
  constructor() {
    super(422, 'media_too_large', 'Media size exceeds maximum allowed limit');
  }
}

export class MediaTypeNotAllowedException extends AppException {
  constructor() {
    super(422, 'media_type_not_allowed', 'Media MIME type is not allowed');
  }
}

export class MediaNotUploadedException extends AppException {
  constructor() {
    super(
      422,
      'media_not_uploaded',
      'Referenced media has not been uploaded or validated in storage',
    );
  }
}

export class NotificationNotFoundException extends AppException {
  constructor() {
    super(404, 'notification_not_found', 'Notification not found');
  }
}

export class InvalidPushTokenException extends AppException {
  constructor(message = 'Push token is empty or malformed') {
    super(422, 'invalid_push_token', message);
  }
}
