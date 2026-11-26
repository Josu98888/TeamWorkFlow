export type AppErrorCode =
  | 'invalid_token'
  | 'forbidden'
  | 'feature_not_in_plan'
  | 'csrf_invalid'
  | 'tenant_suspended'
  | 'tenant_cancelled'
  | 'upstream_timeout'
  | 'upstream_unavailable'
  | 'no_matching_shift'
  | 'clock_in_too_early'
  | 'already_clocked_in'
  | 'invalid_clock_sequence'
  | 'clock_event_not_found'
  | 'workday_not_found'
  | 'alert_not_found'
  | 'site_not_found'
  | 'post_not_found'
  | 'employee_not_found'
  | 'report_not_found'
  | 'report_request_daily_limit_reached'
  | 'mail_delivery_failed'
  | 'clock_too_old'
  | 'invalid_qr'
  | 'alert_invalid_transition'
  | 'rate_limited'
  | 'validation_error';

export interface ValidationErrorItem {
  field: string;
  constraints: string[];
}

export interface AppErrorBody {
  status: number;
  code: AppErrorCode;
  message: string;
  errors?: ValidationErrorItem[];
}

// Domain code throws this; it knows nothing about HTTP or NATS transport.
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

export class InvalidTokenException extends AppException {
  constructor() {
    super(401, 'invalid_token', 'Invalid or expired token');
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'You are not allowed to perform this action') {
    super(403, 'forbidden', message);
  }
}

export class FeatureNotInPlanException extends AppException {
  constructor(feature = 'feature') {
    super(
      403,
      'feature_not_in_plan',
      `The current plan does not include access to ${feature}`,
    );
  }
}

export class CsrfInvalidException extends AppException {
  constructor() {
    super(403, 'csrf_invalid', 'Invalid CSRF token');
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

export class UpstreamTimeoutException extends AppException {
  constructor(service = 'Authentication service') {
    super(504, 'upstream_timeout', `${service} timed out`);
  }
}

export class UpstreamUnavailableException extends AppException {
  constructor(service = 'Authentication service') {
    super(503, 'upstream_unavailable', `${service} is unavailable`);
  }
}

export class NoMatchingShiftException extends AppException {
  constructor() {
    super(404, 'no_matching_shift', 'No matching shift found for this clock event');
  }
}

export class ClockInTooEarlyException extends AppException {
  constructor(formattedTime: string) {
    super(422, 'clock_in_too_early', `Hora de entrada a las ${formattedTime}`);
  }
}

export class AlreadyClockedInException extends AppException {
  constructor() {
    super(409, 'already_clocked_in', 'There is already an open clock-in for this shift');
  }
}

export class InvalidClockSequenceException extends AppException {
  constructor(message = 'Invalid chronological sequence for clock event') {
    super(409, 'invalid_clock_sequence', message);
  }
}

export class ClockEventNotFoundException extends AppException {
  constructor() {
    super(404, 'clock_event_not_found', 'Clock event not found');
  }
}

export class WorkdayNotFoundException extends AppException {
  constructor() {
    super(404, 'workday_not_found', 'Workday not found');
  }
}

export class AlertNotFoundException extends AppException {
  constructor() {
    super(404, 'alert_not_found', 'Alert not found');
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

export class ReportNotFoundException extends AppException {
  constructor() {
    super(404, 'report_not_found', 'Report not found');
  }
}

export class ReportRequestDailyLimitReachedException extends AppException {
  constructor(nextAvailableDate: string) {
    super(
      429,
      'report_request_daily_limit_reached',
      `Solo se puede solicitar este informe una vez al día por sede. Próximo pedido disponible el ${nextAvailableDate}.`,
    );
  }
}

export class MailDeliveryFailedException extends AppException {
  constructor() {
    super(
      502,
      'mail_delivery_failed',
      'No se pudo enviar el informe por correo en este momento. Intentá nuevamente.',
    );
  }
}

export class ClockTooOldException extends AppException {
  constructor() {
    super(422, 'clock_too_old', 'Offline clock event exceeds 24 hour limit');
  }
}

export class InvalidQrException extends AppException {
  constructor() {
    super(422, 'invalid_qr', 'The QR code does not match the site');
  }
}

export class AlertInvalidTransitionException extends AppException {
  constructor(message = 'Invalid alert state transition') {
    super(409, 'alert_invalid_transition', message);
  }
}

export class RateLimitedException extends AppException {
  constructor() {
    super(429, 'rate_limited', 'Too many requests, please try again later');
  }
}

export class ValidationException extends AppException {
  constructor(errors: ValidationErrorItem[]) {
    super(422, 'validation_error', 'Validation failed', errors);
  }
}
