import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { AppErrorBody, AppException } from '../exceptions/app.exceptions';

export interface NatsErrorBody {
  status: number;
  code: AppErrorBody['code'] | 'internal_error';
  message: string;
}

// Responder-side filter for NATS request/reply: sends `{ status, code, message }`
// (the shape telemetry expects) to the caller. Bound on the NATS responders.
@Catch()
export class NatsErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(NatsErrorFilter.name);

  // A microservice filter's catch() MUST return an Observable.
  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    if (exception instanceof AppException) {
      const { status, code, message } = exception.getError();
      return throwError((): NatsErrorBody => ({ status, code, message }));
    }

    // Log the original error, but never send its message or stack to the caller.
    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
    );
    return throwError((): NatsErrorBody => ({
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    }));
  }
}
