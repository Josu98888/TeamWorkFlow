import { RpcException } from '@nestjs/microservices';
import { HttpException } from '@nestjs/common';
import {
  AppException,
  EmailTakenException,
  EmployeeNotFoundException,
  ForbiddenException,
  InvalidCredentialsException,
  InvalidPlanChangeException,
  InvalidSubscriptionTransitionException,
  InvalidTokenException,
  InvalidWebhookSignatureException,
  InvoiceExistsException,
  InvoiceNotFoundException,
  InvoiceNotPayableException,
  NoPendingCancellationException,
  PaymentProviderErrorException,
  PlanNotFoundException,
  ShiftNotEditableException,
  ShiftNotFoundException,
  ShiftOverlapException,
  SubscriptionNotFoundException,
  TenantCancelledException,
  TenantSuspendedException,
  ValidationException,
  VersionConflictException,
  FormNotFoundException,
  TaskNotFoundException,
  MediaNotFoundException,
  FormNotPublishedException,
  TaskNotOpenException,
  TaskAlreadyClaimedException,
  NoShiftInProgressException,
  QrMismatchException,
  AnswerTooOldException,
  MediaTooLargeException,
  MediaTypeNotAllowedException,
  MediaNotUploadedException,
  NotificationNotFoundException,
  InvalidPushTokenException,
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
    [new SubscriptionNotFoundException(), 404, 'subscription_not_found'],
    [new InvoiceNotFoundException(), 404, 'invoice_not_found'],
    [new PlanNotFoundException(), 404, 'plan_not_found'],
    [
      new InvalidSubscriptionTransitionException(),
      409,
      'invalid_subscription_transition',
    ],
    [new InvalidPlanChangeException(), 409, 'invalid_plan_change'],
    [new NoPendingCancellationException(), 409, 'no_pending_cancellation'],
    [new InvoiceNotPayableException(), 409, 'invoice_not_payable'],
    [new InvoiceExistsException(), 409, 'invoice_exists'],
    [new InvalidWebhookSignatureException(), 401, 'invalid_webhook_signature'],
    [new PaymentProviderErrorException(), 502, 'payment_provider_error'],
    [new FormNotFoundException(), 404, 'form_not_found'],
    [new TaskNotFoundException(), 404, 'task_not_found'],
    [new MediaNotFoundException(), 404, 'media_not_found'],
    [new FormNotPublishedException(), 409, 'form_not_published'],
    [new TaskNotOpenException(), 409, 'task_not_open'],
    [new TaskAlreadyClaimedException(), 409, 'task_already_claimed'],
    [new NoShiftInProgressException(), 403, 'no_shift_in_progress'],
    [new QrMismatchException(), 422, 'qr_mismatch'],
    [new AnswerTooOldException(), 422, 'answer_too_old'],
    [new MediaTooLargeException(), 422, 'media_too_large'],
    [new MediaTypeNotAllowedException(), 422, 'media_type_not_allowed'],
    [new MediaNotUploadedException(), 422, 'media_not_uploaded'],
    [new NotificationNotFoundException(), 404, 'notification_not_found'],
    [new InvalidPushTokenException(), 422, 'invalid_push_token'],
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
    expect(new SubscriptionNotFoundException().name).toBe(
      'SubscriptionNotFoundException',
    );
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
