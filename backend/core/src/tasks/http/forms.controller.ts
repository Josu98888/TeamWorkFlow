import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { RequiresFeature } from '../../http/decorators/requires-feature.decorator';
import { TasksService } from '../tasks.service';
import {
  CreateFormBodyDto,
  FormIdParamDto,
  UpdateFormBodyDto,
} from './dto/tasks.dto';

@Controller('forms')
@RequiresFeature('tasks')
export class FormsController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: CreateFormBodyDto,
  ) {
    this.assertManager(actor);
    return this.tasksService.formCreate(this.toActor(actor), body);
  }

  @Patch(':formId')
  update(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: FormIdParamDto,
    @Body() body: UpdateFormBodyDto,
  ) {
    this.assertManager(actor);
    return this.tasksService.formUpdate(this.toActor(actor), param.formId, body);
  }

  @Post(':formId/publish')
  publish(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: FormIdParamDto,
  ) {
    this.assertManager(actor);
    return this.tasksService.formPublish(this.toActor(actor), param.formId);
  }

  @Get(':formId')
  get(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: FormIdParamDto,
  ) {
    return this.tasksService.formGet(this.toActor(actor), param.formId);
  }

  @Get()
  list(
    @CurrentActor() actor: VerifiedActor,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.tasksService.formList(this.toActor(actor), p, ps);
  }

  private assertManager(actor: VerifiedActor) {
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new ForbiddenException();
    }
  }

  private toActor(actor: VerifiedActor) {
    return {
      userId: actor.userId,
      tenantId: actor.tenantId ?? '',
      role: actor.role,
    };
  }
}
