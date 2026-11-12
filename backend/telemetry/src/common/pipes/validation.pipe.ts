import { ValidationError, ValidationPipe } from '@nestjs/common';
import {
  ValidationErrorItem,
  ValidationException,
} from '../exceptions/app.exceptions';

export function toValidationErrorItems(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorItem[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own: ValidationErrorItem[] = error.constraints
      ? [{ field, constraints: Object.values(error.constraints) }]
      : [];

    return [...own, ...toValidationErrorItems(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new ValidationException(toValidationErrorItems(errors)),
  });
}
