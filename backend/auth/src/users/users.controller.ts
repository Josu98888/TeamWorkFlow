import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '../auth/auth.patterns';
import { AssignUserSitesDto } from './dto/user-assign-sites.dto';
import { ChangeUserRoleDto } from './dto/user-change-role.dto';
import { UserAssignSitesService } from './user-assign-sites.service';
import { UserChangeRoleService } from './user-change-role.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class UsersController {
  constructor(
    private readonly changeRoleService: UserChangeRoleService,
    private readonly assignSitesService: UserAssignSitesService,
  ) {}

  @MessagePattern(AUTH_PATTERNS.userChangeRole)
  changeRole(@Payload() dto: ChangeUserRoleDto): Promise<{ ok: true }> {
    return this.changeRoleService.changeRole(dto);
  }

  @MessagePattern(AUTH_PATTERNS.userAssignSites)
  assignSites(@Payload() dto: AssignUserSitesDto): Promise<{ ok: true }> {
    return this.assignSitesService.assignSites(dto);
  }
}
