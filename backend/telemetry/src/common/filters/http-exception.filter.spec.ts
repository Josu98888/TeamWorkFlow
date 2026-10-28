import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpErrorFilter } from './http-exception.filter';
import {
  InvalidTokenException,
  ValidationException,
} from '../exceptions/app.exceptions';

describe('HttpErrorFilter', () => {
  let filter: HttpErrorFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpErrorFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('formats AppException into { detail, code }', () => {
    filter.catch(new InvalidTokenException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(mockJson).toHaveBeenCalledWith({
      detail: 'Invalid or expired token',
      code: 'invalid_token',
    });
  });

  it('formats ValidationException with errors array', () => {
    const errors = [{ field: 'qrCode', constraints: ['isNotEmpty'] }];
    filter.catch(new ValidationException(errors), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(422);
    expect(mockJson).toHaveBeenCalledWith({
      detail: 'Validation failed',
      code: 'validation_error',
      errors,
    });
  });

  it('formats standard HttpException with status mapping', () => {
    const httpExc = new HttpException('Forbidden resource', HttpStatus.FORBIDDEN);
    filter.catch(httpExc, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(403);
    expect(mockJson).toHaveBeenCalledWith({
      detail: 'Forbidden resource',
      code: 'forbidden',
    });
  });

  it('formats unknown errors as 500 internal_error without leaking internals', () => {
    filter.catch(new Error('Sensitive DB crash info'), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith({
      detail: 'Internal server error',
      code: 'internal_error',
    });
  });
});
