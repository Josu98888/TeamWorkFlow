import { ValidationError, ValidationPipe } from '@nestjs/common';
import {
  ValidationErrorItem,
  ValidationException,
} from '../exceptions/app.exceptions';

// Flattens nested DTO errors into `{ field: 'address.street', constraints }`.
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
    /// Domain ValidationException (422), not Nest's BadRequestException.
    exceptionFactory: (errors) =>
      new ValidationException(toValidationErrorItems(errors)),
  });
}
