import { INestApplication } from '@nestjs/common';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { HttpErrorFilter } from './common/filters/http-exception.filter';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1/telemetry');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
}
