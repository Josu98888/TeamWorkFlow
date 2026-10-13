import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '../auth/auth.patterns';
import { AssignUserSitesDto } from './dto/user-assign-sites.dto';
import { ChangeUserRoleDto } from './dto/user-change-role.dto';
import { DeactivateUserDto } from './dto/user-deactivate.dto';
import { UserAssignSitesService } from './user-assign-sites.service';
import { UserChangeRoleService } from './user-change-role.service';
import { UserDeactivateService } from './user-deactivate.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class UsersController {
  constructor(
    private readonly changeRoleService: UserChangeRoleService,
    private readonly assignSitesService: UserAssignSitesService,
    private readonly deactivateService: UserDeactivateService,
  ) {}

  @MessagePattern(AUTH_PATTERNS.userChangeRole)
  changeRole(@Payload() dto: ChangeUserRoleDto): Promise<{ ok: true }> {
    return this.changeRoleService.changeRole(dto);
  }

  @MessagePattern(AUTH_PATTERNS.userAssignSites)
  assignSites(@Payload() dto: AssignUserSitesDto): Promise<{ ok: true }> {
    return this.assignSitesService.assignSites(dto);
  }

  @MessagePattern(AUTH_PATTERNS.userDeactivate)
  deactivate(@Payload() dto: DeactivateUserDto): Promise<{ ok: true }> {
    return this.deactivateService.deactivate(dto);
  }
}
