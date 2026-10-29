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
  CancelShiftBodyDto,
  CreateShiftBodyDto,
  ListShiftsQueryDto,
  ReassignShiftBodyDto,
  ShiftIdParamDto,
  UpdateShiftBodyDto,
} from './dto/shift.dto';
import {
  ShiftsService,
  type ShiftView,
  type ShiftWithWarnings,
} from './shifts.service';

// HTTP transport only (route map in `backend/core/AGENTS.md`). The actor comes
// from the AuthGuard; roles and site scope are enforced by the service.
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post()
  create(
    @CurrentActor() actor: OrganizationActor,
    @Body() body: CreateShiftBodyDto,
  ): Promise<ShiftWithWarnings> {
    return this.shifts.create(toOrganizationActor(actor), body);
  }

  @Get()
  list(
    @CurrentActor() actor: OrganizationActor,
    @Query() query: ListShiftsQueryDto,
  ): Promise<PageResult<ShiftView>> {
    return this.shifts.list(toOrganizationActor(actor), query);
  }

  @Get(':shiftId')
  get(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: ShiftIdParamDto,
  ): Promise<ShiftView> {
    return this.shifts.get(toOrganizationActor(actor), params.shiftId);
  }

  @Patch(':shiftId')
  update(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: ShiftIdParamDto,
    @Body() body: UpdateShiftBodyDto,
  ): Promise<ShiftWithWarnings> {
    return this.shifts.update(toOrganizationActor(actor), params.shiftId, body);
  }

  @Post(':shiftId/reassign')
  reassign(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: ShiftIdParamDto,
    @Body() body: ReassignShiftBodyDto,
  ): Promise<ShiftWithWarnings> {
    return this.shifts.reassign(
      toOrganizationActor(actor),
      params.shiftId,
      body,
    );
  }

  @Post(':shiftId/cancel')
  cancel(
    @CurrentActor() actor: OrganizationActor,
    @Param() params: ShiftIdParamDto,
    @Body() body: CancelShiftBodyDto,
  ): Promise<ShiftView> {
    return this.shifts.cancel(toOrganizationActor(actor), params.shiftId, body);
  }
}
