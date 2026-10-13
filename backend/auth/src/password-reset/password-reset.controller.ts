import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '../auth/auth.patterns';
import { ConfirmPasswordResetDto } from './dto/password-reset-confirm.dto';
import { CreatePasswordResetDto } from './dto/password-reset-create.dto';
import {
  CreatedPasswordReset,
  PasswordResetCreateService,
} from './password-reset-create.service';
import { PasswordResetConfirmService } from './password-reset-confirm.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class PasswordResetController {
  constructor(
    private readonly createService: PasswordResetCreateService,
    private readonly confirmService: PasswordResetConfirmService,
  ) {}

  @MessagePattern(AUTH_PATTERNS.passwordResetCreate)
  create(
    @Payload() dto: CreatePasswordResetDto,
  ): Promise<CreatedPasswordReset> {
    return this.createService.create(dto);
  }

  // Public pattern: no actor, the reset token is the credential.
  @MessagePattern(AUTH_PATTERNS.passwordResetConfirm)
  confirm(@Payload() dto: ConfirmPasswordResetDto): Promise<{ ok: true }> {
    return this.confirmService.confirm(dto);
  }
}
