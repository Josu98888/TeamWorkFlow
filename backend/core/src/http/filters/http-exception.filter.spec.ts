import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EmailTakenException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { HttpErrorFilter } from './http-exception.filter';

function setup() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { filter: new HttpErrorFilter(), host, status, json };
}

describe('HttpErrorFilter', () => {
  it('maps an AppException to its status and { detail, code }', () => {
    const { filter, host, status, json } = setup();

    filter.catch(new EmailTakenException(), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      detail: 'Email is already in use',
      code: 'email_taken',
    });
  });

  it('adds the field errors for a ValidationException', () => {
    const { filter, host, status, json } = setup();
    const errors = [
      { field: 'email', constraints: ['email must be an email'] },
    ];

    filter.catch(new ValidationException(errors), host);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      detail: 'Validation failed',
      code: 'validation_error',
      errors,
    });
  });

  it('maps a Nest HttpException to a snake_case code', () => {
    const { filter, host, status, json } = setup();

    filter.catch(new NotFoundException('Cannot GET /api/x'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      detail: 'Cannot GET /api/x',
      code: 'not_found',
    });
  });

  it('uses a generic detail when the HttpException message is a list', () => {
    const { filter, host, json } = setup();

    filter.catch(new BadRequestException(['a', 'b']), host);

    expect(json).toHaveBeenCalledWith({
      detail: 'Bad Request Exception',
      code: 'bad_request',
    });
  });

  it('answers 500 internal_error for unknown errors without leaking them', () => {
    const { filter, host, status, json } = setup();
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('db password is hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      detail: 'Internal server error',
      code: 'internal_error',
    });
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
