import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { ClockInsService } from './clock-ins.service';
import {
  ClockEventIdParamDto,
  CorrectClockEventDto,
  CreateClockEventDto,
  CreateManualClockEventDto,
  ListClockEventsDto,
} from './dto';

@Controller('clock-events')
export class ClockInsController {
  constructor(private readonly clockInsService: ClockInsService) {}

  @Post()
  @Roles('employee')
  @HttpCode(HttpStatus.CREATED)
  createClockEvent(
    @CurrentActor() actor: VerifiedActor,
    @Body() dto: CreateClockEventDto,
  ) {
    return this.clockInsService.createClockEvent(actor, dto);
  }

  @Post('manual')
  @Roles('supervisor', 'admin', 'owner')
  @HttpCode(HttpStatus.CREATED)
  createManualClockEvent(
    @CurrentActor() actor: VerifiedActor,
    @Body() dto: CreateManualClockEventDto,
  ) {
    return this.clockInsService.createManualClockEvent(actor, dto);
  }

  @Patch(':clockEventId')
  @Roles('supervisor', 'admin', 'owner')
  correctClockEvent(
    @CurrentActor() actor: VerifiedActor,
    @Param() { clockEventId }: ClockEventIdParamDto,
    @Body() dto: CorrectClockEventDto,
  ) {
    return this.clockInsService.correctClockEvent(actor, clockEventId, dto);
  }

  @Get()
  @Roles('employee', 'supervisor', 'admin', 'owner')
  listClockEvents(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ListClockEventsDto,
  ) {
    return this.clockInsService.listClockEvents(actor, query);
  }
}
