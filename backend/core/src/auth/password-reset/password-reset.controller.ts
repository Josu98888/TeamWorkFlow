import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { Public } from '../../http/decorators/public.decorator';
import { toServiceActor } from '../service-actor';
import { UserIdParamDto } from '../users/dto/user-id-param.dto';
import type { VerifiedActor } from '../verified-actor';
import { ConfirmPasswordResetDto } from './dto/password-reset-confirm.dto';
import { PasswordResetConfirmService } from './password-reset-confirm.service';
import {
  CreatedPasswordReset,
  PasswordResetCreateService,
} from './password-reset-create.service';

// HTTP transport only: the actor comes from the guard, never from the body.
@Controller('auth')
export class PasswordResetController {
  constructor(
    private readonly createService: PasswordResetCreateService,
    private readonly confirmService: PasswordResetConfirmService,
  ) {}

  @Post('users/:userId/password-reset')
  create(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: UserIdParamDto,
  ): Promise<CreatedPasswordReset> {
    return this.createService.create(
      Object.assign({}, params, { actor: toServiceActor(actor) }),
    );
  }

  // Public: the reset token in the body is the credential.
  @Public()
  @Post('password-reset/confirm')
  confirm(@Body() body: ConfirmPasswordResetDto): Promise<{ ok: true }> {
    return this.confirmService.confirm(body);
  }
}
