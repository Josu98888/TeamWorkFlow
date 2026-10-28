import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exceptions';

const HTTP_STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'rate_limited',
  503: 'upstream_unavailable',
  504: 'upstream_timeout',
};

// Maps every error to the public HTTP body `{ detail, code }`
// (`errors` is added only for validation failures).
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const { status, code, message, errors } = exception.getError();
      return response.status(status).json({
        detail: message,
        code,
        ...(errors ? { errors } : {}),
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        typeof (body as Record<string, unknown>).message === 'string'
          ? (body as { message: string }).message
          : exception.message;

      return response.status(status).json({
        detail: message,
        code: HTTP_STATUS_CODES[status] ?? 'http_error',
      });
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
    );

    return response
      .status(500)
      .json({ detail: 'Internal server error', code: 'internal_error' });
  }
}
