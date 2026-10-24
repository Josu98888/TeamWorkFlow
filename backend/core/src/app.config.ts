import { INestApplication } from '@nestjs/common';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { HttpErrorFilter } from './http/filters/http-exception.filter';

// Global setup shared by main.ts and the e2e tests so both run the same stack.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
}
