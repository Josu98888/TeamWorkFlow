import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import {
  toOrganizationActor,
  type OrganizationActor,
} from '../organization-actor';
import type { PageResult } from '../sites/sites.service';
import {
  CreateEmployeeBodyDto,
  EmployeeIdParamDto,
  ListEmployeesQueryDto,
  UpdateEmployeeBodyDto,
} from './dto/employee.dto';
import { EmployeesService, type EmployeeView } from './employees.service';

// HTTP transport only (route map in `backend/core/AGENTS.md`). The actor comes
// from the AuthGuard; roles and visibility are enforced by the service.
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  create(
    @CurrentActor() actor: OrganizationActor,
    @Body() body: CreateEmployeeBodyDto,
  ): Promise<EmployeeView> {
    return this.employees.create(toOrganizationActor(actor), body);
  }

  @Get()
  list(
    @CurrentActor() actor: OrganizationActor,
    @Query() query: ListEmployeesQueryDto,
  ): Promise<PageResult<EmployeeView>> {
    return this.employees.list(toOrganizationActor(actor), query);
  }

  @Get(':employeeId')
  get(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: EmployeeIdParamDto,
  ): Promise<EmployeeView> {
    return this.employees.get(toOrganizationActor(actor), {
      employeeId: params.employeeId,
    });
  }

  @Patch(':employeeId')
  update(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: EmployeeIdParamDto,
    @Body() body: UpdateEmployeeBodyDto,
  ): Promise<EmployeeView> {
    return this.employees.update(
      toOrganizationActor(actor),
      params.employeeId,
      body,
    );
  }
}
