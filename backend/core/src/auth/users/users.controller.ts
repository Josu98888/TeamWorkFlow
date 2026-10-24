import { Body, Controller, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { toServiceActor } from '../service-actor';
import type { VerifiedActor } from '../verified-actor';
import { AssignUserSitesBodyDto } from './dto/user-assign-sites.dto';
import { ChangeUserRoleBodyDto } from './dto/user-change-role.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { UserAssignSitesService } from './user-assign-sites.service';
import { UserChangeRoleService } from './user-change-role.service';
import { UserDeactivateService } from './user-deactivate.service';

// HTTP transport only. `auth.user.list-recipients` is internal to core and has
// no route here.
@Controller('auth/users')
export class UsersController {
  constructor(
    private readonly changeRoleService: UserChangeRoleService,
    private readonly assignSitesService: UserAssignSitesService,
    private readonly deactivateService: UserDeactivateService,
  ) {}

  @Patch(':userId/role')
  changeRole(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: UserIdParamDto,
    @Body() body: ChangeUserRoleBodyDto,
  ): Promise<{ ok: true }> {
    return this.changeRoleService.changeRole(
      Object.assign({}, body, params, { actor: toServiceActor(actor) }),
    );
  }

  @Put(':userId/sites')
  assignSites(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: UserIdParamDto,
    @Body() body: AssignUserSitesBodyDto,
  ): Promise<{ ok: true }> {
    return this.assignSitesService.assignSites(
      Object.assign({}, body, params, { actor: toServiceActor(actor) }),
    );
  }

  @Post(':userId/deactivate')
  deactivate(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: UserIdParamDto,
  ): Promise<{ ok: true }> {
    return this.deactivateService.deactivate(
      Object.assign({}, params, { actor: toServiceActor(actor) }),
    );
  }
}
