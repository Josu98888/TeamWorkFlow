import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { WorkdaysService } from './workdays.service';
import {
  ListWorkdaysDto,
  ShiftIdParamDto,
} from './dto';

@Controller('workdays')
export class WorkdaysController {
  constructor(private readonly workdaysService: WorkdaysService) {}

  @Get(':shiftId')
  @Roles('employee', 'supervisor', 'admin', 'owner')
  getWorkday(
    @CurrentActor() actor: VerifiedActor,
    @Param() { shiftId }: ShiftIdParamDto,
  ) {
    return this.workdaysService.getWorkdayByShiftId(actor, shiftId);
  }

  @Get()
  @Roles('employee', 'supervisor', 'admin', 'owner')
  listWorkdays(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ListWorkdaysDto,
  ) {
    return this.workdaysService.listWorkdays(actor, query);
  }
}
