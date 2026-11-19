import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { envs } from './config';
import { HttpErrorFilter } from './http/filters/http-exception.filter';

// Global setup shared by main.ts and the e2e tests so both run the same stack.
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
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
}
