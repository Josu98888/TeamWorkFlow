import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '../auth/auth.patterns';
import { ChangeUserRoleDto } from './dto/user-change-role.dto';
import { UserChangeRoleService } from './user-change-role.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class UsersController {
  constructor(private readonly changeRoleService: UserChangeRoleService) {}

  @MessagePattern(AUTH_PATTERNS.userChangeRole)
  changeRole(@Payload() dto: ChangeUserRoleDto): Promise<{ ok: true }> {
    return this.changeRoleService.changeRole(dto);
  }
}
