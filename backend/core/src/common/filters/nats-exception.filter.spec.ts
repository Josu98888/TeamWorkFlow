import { ArgumentsHost, Logger } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import {
  InvalidTokenException,
  ValidationException,
} from '../exceptions/app.exceptions';
import { NatsErrorFilter } from './nats-exception.filter';

const host = {} as ArgumentsHost;

async function rejection(result: ReturnType<NatsErrorFilter['catch']>) {
  try {
    await lastValueFrom(result);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the filter to emit an error');
}

describe('NatsErrorFilter', () => {
  const filter = new NatsErrorFilter();

  it('maps an AppException to { status, code, message }', async () => {
    const error = await rejection(
      filter.catch(new InvalidTokenException(), host),
    );

    expect(error).toEqual({
      status: 401,
      code: 'invalid_token',
      message: 'Invalid or expired token',
    });
  });

  it('does not send validation field errors over NATS', async () => {
    const error = await rejection(
      filter.catch(new ValidationException([]), host),
    );

    expect(error).toEqual({
      status: 422,
      code: 'validation_error',
      message: 'Validation failed',
    });
  });

  it('answers 500 internal_error for unknown errors without leaking them', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const error = await rejection(filter.catch(new Error('secret'), host));

    expect(error).toEqual({
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    });
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
