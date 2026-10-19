import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Response } from 'express';

@Catch(RpcException)
export class RpcExceptionFilter implements ExceptionFilter {
  catch(exception: RpcException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const rpcError = exception.getError() as {
      status?: number;
      code?: string;
      message?: string;
    };

    const status = rpcError.status || HttpStatus.INTERNAL_SERVER_ERROR;
    const code = rpcError.code || 'internal_error';
    const message = rpcError.message || 'Internal server error';

    response.status(status).json({
      detail: message,
      code: code,
    });
  }
}
