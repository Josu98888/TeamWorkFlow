import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { HttpErrorFilter } from './common/filters/http-exception.filter';
import { envs } from './config';

export function configureApp(app: INestApplication): void {
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter?.getInstance?.() as
    | { set?: (setting: string, val: unknown) => void }
    | undefined;
  if (typeof instance?.set === 'function') {
    instance.set('trust proxy', 1);
  }

  app.use(helmet());
  app.enableCors({
    origin: envs.webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Client',
    ],
  });
  app.setGlobalPrefix('api/v1/telemetry');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
}
