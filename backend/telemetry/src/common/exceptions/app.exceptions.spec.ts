import {
  ForbiddenException,
  InvalidTokenException,
  FeatureNotInPlanException,
  CsrfInvalidException,
  TenantSuspendedException,
  TenantCancelledException,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
  NoMatchingShiftException,
  WorkdayNotFoundException,
  ValidationException,
} from './app.exceptions';

describe('AppExceptions', () => {
  it('creates InvalidTokenException with status 401 and invalid_token code', () => {
    const exc = new InvalidTokenException();
    expect(exc.status).toBe(401);
    expect(exc.code).toBe('invalid_token');
    expect(exc.message).toBe('Invalid or expired token');
    expect(exc.getError()).toEqual({
      status: 401,
      code: 'invalid_token',
      message: 'Invalid or expired token',
    });
  });

  it('creates ForbiddenException with status 403', () => {
    const exc = new ForbiddenException();
    expect(exc.status).toBe(403);
    expect(exc.code).toBe('forbidden');
  });

  it('creates FeatureNotInPlanException with status 403 and custom feature message', () => {
    const exc = new FeatureNotInPlanException('alerts');
    expect(exc.status).toBe(403);
    expect(exc.code).toBe('feature_not_in_plan');
    expect(exc.message).toContain('alerts');
  });

  it('creates CsrfInvalidException with status 403', () => {
    const exc = new CsrfInvalidException();
    expect(exc.status).toBe(403);
    expect(exc.code).toBe('csrf_invalid');
  });

  it('creates TenantSuspendedException and TenantCancelledException', () => {
    const suspended = new TenantSuspendedException();
    expect(suspended.status).toBe(403);
    expect(suspended.code).toBe('tenant_suspended');

    const cancelled = new TenantCancelledException();
    expect(cancelled.status).toBe(403);
    expect(cancelled.code).toBe('tenant_cancelled');
  });

  it('creates UpstreamTimeoutException with status 504', () => {
    const exc = new UpstreamTimeoutException();
    expect(exc.status).toBe(504);
    expect(exc.code).toBe('upstream_timeout');
  });

  it('creates UpstreamUnavailableException with status 503', () => {
    const exc = new UpstreamUnavailableException();
    expect(exc.status).toBe(503);
    expect(exc.code).toBe('upstream_unavailable');
  });

  it('creates NoMatchingShiftException with status 404', () => {
    const exc = new NoMatchingShiftException();
    expect(exc.status).toBe(404);
    expect(exc.code).toBe('no_matching_shift');
  });

  it('creates WorkdayNotFoundException with status 404', () => {
    const exc = new WorkdayNotFoundException();
    expect(exc.status).toBe(404);
    expect(exc.code).toBe('workday_not_found');
  });

  it('creates ValidationException with status 422 and errors list', () => {
    const errors = [{ field: 'latitude', constraints: ['isNumber'] }];
    const exc = new ValidationException(errors);
    expect(exc.status).toBe(422);
    expect(exc.code).toBe('validation_error');
    expect(exc.getError()).toEqual({
      status: 422,
      code: 'validation_error',
      message: 'Validation failed',
      errors,
    });
  });
});
