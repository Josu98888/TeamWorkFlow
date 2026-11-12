import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import type { VerifiedActor } from '../../auth/verified-actor';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { RequiresFeature } from '../../http/decorators/requires-feature.decorator';
import { TasksService } from '../tasks.service';
import { MediaIdParamDto, RequestUploadBodyDto } from './dto/tasks.dto';

@Controller('media')
@RequiresFeature('tasks')
export class MediaController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('uploads')
  requestUpload(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: RequestUploadBodyDto,
  ) {
    if (actor.role !== 'employee') {
      throw new ForbiddenException();
    }
    return this.tasksService.mediaRequestUpload(this.toActor(actor), body);
  }

  @Get(':mediaId/url')
  getUrl(
    @CurrentActor() actor: VerifiedActor,
    @Param() param: MediaIdParamDto,
  ) {
    return this.tasksService.mediaGetUrl(this.toActor(actor), param.mediaId);
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
