import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NatsErrorFilter } from '../common/filters/nats-exception.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { AuthService } from './auth.service';
import { AUTH_PATTERNS } from './auth.patterns';
import { VerifyTokenDto } from './dto/verify-token.dto';
import type { VerifiedActor } from './verified-actor';

// NATS request-reply responder for `telemetry`. Thin: it calls the same facade
// operation as the HTTP guard. The global HTTP pipe and filter do not apply to
// the microservice, so both are bound here.
@Controller()
@UseFilters(NatsErrorFilter)
@UsePipes(createValidationPipe())
export class AuthTokenResponder {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_PATTERNS.tokenVerify)
  verify(@Payload() dto: VerifyTokenDto): Promise<VerifiedActor> {
    return this.authService.verify(dto);
  }
}
