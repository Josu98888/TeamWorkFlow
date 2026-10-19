import { Module } from '@nestjs/common';
import { PasswordResetConfirmService } from './password-reset-confirm.service';
import { PasswordResetCreateService } from './password-reset-create.service';
import { PasswordResetController } from './password-reset.controller';

@Module({
  controllers: [PasswordResetController],
  providers: [PasswordResetCreateService, PasswordResetConfirmService],
})
export class PasswordResetModule {}
