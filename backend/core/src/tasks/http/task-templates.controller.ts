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
  CreateTaskTemplateBodyDto,
  ListTemplatesQueryDto,
  TemplateIdParamDto,
  UpdateTaskTemplateBodyDto,
} from './dto/tasks.dto';

@Controller('task-templates')
@RequiresFeature('tasks')
export class TaskTemplatesController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: CreateTaskTemplateBodyDto,
  ) {
    this.assertManager(actor);
    return this.tasksService.taskTemplateCreate(this.toActor(actor), body);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: TemplateIdParamDto,
    @Body() body: UpdateTaskTemplateBodyDto,
  ) {
    this.assertManager(actor);
    return this.tasksService.taskTemplateUpdate(this.toActor(actor), param.id, body);
  }

  @Get()
  list(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ListTemplatesQueryDto,
  ) {
    return this.tasksService.taskTemplateList(this.toActor(actor), query);
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
