import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { CompensationService } from './compensation.service';
import {
  CompensationEmployeeIdParamDto,
  CompensationPostIdParamDto,
  UpsertEmployeeCompensationDto,
  UpsertPostOvertimeRateDto,
} from './dto/compensation.dto';

@Controller('compensation')
export class CompensationController {
  constructor(private readonly compensation: CompensationService) {}

  @Get('employees')
  @Roles('owner', 'admin')
  listEmployeeCompensations(@CurrentActor() actor: VerifiedActor) {
    return this.compensation.listEmployeeCompensations(actor);
  }

  @Put('employees/:employeeId')
  @Roles('owner', 'admin')
  upsertEmployeeCompensation(
    @CurrentActor() actor: VerifiedActor,
    @Param() { employeeId }: CompensationEmployeeIdParamDto,
    @Body() dto: UpsertEmployeeCompensationDto,
  ) {
    return this.compensation.upsertEmployeeCompensation(actor, employeeId, dto);
  }

  @Get('posts')
  @Roles('owner', 'admin')
  listPostOvertimeRates(@CurrentActor() actor: VerifiedActor) {
    return this.compensation.listPostOvertimeRates(actor);
  }

  @Put('posts/:postId')
  @Roles('owner', 'admin')
  upsertPostOvertimeRate(
    @CurrentActor() actor: VerifiedActor,
    @Param() { postId }: CompensationPostIdParamDto,
    @Body() dto: UpsertPostOvertimeRateDto,
  ) {
    return this.compensation.upsertPostOvertimeRate(actor, postId, dto);
  }

  @Get('history')
  @Roles('owner', 'admin')
  listHistory(@CurrentActor() actor: VerifiedActor) {
    return this.compensation.listHistory(actor);
  }
}
