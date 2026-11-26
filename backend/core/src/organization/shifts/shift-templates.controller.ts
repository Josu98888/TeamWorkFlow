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
  CreateShiftTemplateBodyDto,
  ListShiftTemplatesQueryDto,
  ShiftTemplateIdParamDto,
  UpdateShiftTemplateBodyDto,
} from './dto/shift-template.dto';
import {
  ShiftTemplatesService,
  type ShiftTemplateView,
  type ShiftTemplateWithGeneration,
} from './shift-templates.service';

// HTTP transport only (route map in `backend/core/AGENTS.md`). The actor comes
// from the AuthGuard; roles and site scope are enforced by the service.
@Controller('shift-templates')
export class ShiftTemplatesController {
  constructor(private readonly templates: ShiftTemplatesService) {}

  @Post()
  create(
    @CurrentActor() actor: OrganizationActor,
    @Body() body: CreateShiftTemplateBodyDto,
  ): Promise<ShiftTemplateWithGeneration> {
    return this.templates.create(toOrganizationActor(actor), body);
  }

  @Patch(':templateId')
  update(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: ShiftTemplateIdParamDto,
    @Body() body: UpdateShiftTemplateBodyDto,
  ): Promise<ShiftTemplateWithGeneration> {
    return this.templates.update(
      toOrganizationActor(actor),
      params.templateId,
      body,
    );
  }

  @Post(':templateId/deactivate')
  deactivate(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: ShiftTemplateIdParamDto,
  ): Promise<ShiftTemplateView> {
    return this.templates.deactivate(
      toOrganizationActor(actor),
      params.templateId,
    );
  }

  @Get()
  list(
    @CurrentActor() actor: OrganizationActor,
    @Query() query: ListShiftTemplatesQueryDto,
  ): Promise<PageResult<ShiftTemplateView>> {
    return this.templates.list(toOrganizationActor(actor), query);
  }
}
