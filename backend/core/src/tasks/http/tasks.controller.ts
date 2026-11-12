import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { RequiresFeature } from '../../http/decorators/requires-feature.decorator';
import { TasksService } from '../tasks.service';
import {
  AnswerTaskBodyDto,
  CreateTaskBodyDto,
  ListTasksQueryDto,
  ReviewTaskBodyDto,
  TaskIdParamDto,
} from './dto/tasks.dto';

@Controller('tasks')
@RequiresFeature('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: CreateTaskBodyDto,
  ) {
    if (actor.role !== 'owner' && actor.role !== 'admin' && actor.role !== 'supervisor') {
      throw new ForbiddenException();
    }
    return this.tasksService.taskCreate(this.toActor(actor), body);
  }

  @Get(':taskId')
  get(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: TaskIdParamDto,
  ) {
    return this.tasksService.taskGet(this.toActor(actor), param.taskId);
  }

  @Get()
  list(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasksService.taskList(this.toActor(actor), query);
  }

  @Post(':taskId/claim')
  claim(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: TaskIdParamDto,
  ) {
    if (actor.role !== 'employee') {
      throw new ForbiddenException();
    }
    return this.tasksService.taskClaim(this.toActor(actor), param.taskId);
  }

  @Post(':taskId/answer')
  answer(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: TaskIdParamDto,
    @Body() body: AnswerTaskBodyDto,
  ) {
    if (actor.role !== 'employee') {
      throw new ForbiddenException();
    }
    return this.tasksService.taskAnswer(this.toActor(actor), {
      ...body,
      taskId: param.taskId,
    });
  }

  @Post(':taskId/review')
  review(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: TaskIdParamDto,
    @Body() body: ReviewTaskBodyDto,
  ) {
    if (actor.role !== 'owner' && actor.role !== 'admin' && actor.role !== 'supervisor') {
      throw new ForbiddenException();
    }
    return this.tasksService.taskReview(this.toActor(actor), param.taskId, body);
  }

  private toActor(actor: VerifiedActor) {
    return {
      userId: actor.userId,
      tenantId: actor.tenantId ?? '',
      role: actor.role,
      siteIds: actor.siteIds,
    };
  }
}
