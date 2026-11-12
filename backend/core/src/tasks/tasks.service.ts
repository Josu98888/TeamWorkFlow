import { Injectable } from '@nestjs/common';
import type { FormActor, CreateFormDto, UpdateFormDto } from './forms/forms.service';
import { FormsService } from './forms/forms.service';
import type {
  TemplateActor,
  CreateTaskTemplateDto,
  UpdateTaskTemplateDto,
} from './templates/task-templates.service';
import { TaskTemplatesService } from './templates/task-templates.service';
import type {
  MediaActor,
  RequestUploadDto,
} from './media/media.service';
import { MediaService } from './media/media.service';
import type {
  TaskActor,
  CreateTaskDto,
  AnswerTaskDto,
  ReviewTaskDto,
  ListTasksQuery,
} from './task-management/task-management.service';
import { TaskManagementService } from './task-management/task-management.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly forms: FormsService,
    private readonly templates: TaskTemplatesService,
    private readonly media: MediaService,
    private readonly tasks: TaskManagementService,
  ) {}

  // tasks.form.create
  formCreate(actor: FormActor, dto: CreateFormDto) {
    return this.forms.create(actor, dto);
  }

  // tasks.form.update
  formUpdate(actor: FormActor, formId: string, dto: UpdateFormDto) {
    return this.forms.update(actor, formId, dto);
  }

  // tasks.form.publish
  formPublish(actor: FormActor, formId: string) {
    return this.forms.publish(actor, formId);
  }

  // tasks.form.get
  formGet(actor: FormActor, formId: string) {
    return this.forms.get(actor, formId);
  }

  // tasks.form.list
  formList(actor: FormActor, page?: number, pageSize?: number) {
    return this.forms.list(actor, page, pageSize);
  }

  // tasks.task-template.create
  taskTemplateCreate(actor: TemplateActor, dto: CreateTaskTemplateDto) {
    return this.templates.create(actor, dto);
  }

  // tasks.task-template.update
  taskTemplateUpdate(
    actor: TemplateActor,
    id: string,
    dto: UpdateTaskTemplateDto,
  ) {
    return this.templates.update(actor, id, dto);
  }

  // tasks.task-template.list
  taskTemplateList(
    actor: TemplateActor,
    filters?: { siteId?: string; postId?: string },
  ) {
    return this.templates.list(actor, filters);
  }

  // tasks.task.create
  taskCreate(actor: TaskActor, dto: CreateTaskDto) {
    return this.tasks.create(actor, dto);
  }

  // tasks.task.get
  taskGet(actor: TaskActor, taskId: string) {
    return this.tasks.get(actor, taskId);
  }

  // tasks.task.list
  taskList(actor: TaskActor, query: ListTasksQuery) {
    return this.tasks.list(actor, query);
  }

  // tasks.task.claim
  taskClaim(actor: TaskActor, taskId: string) {
    return this.tasks.claim(actor, taskId);
  }

  // tasks.task.answer
  taskAnswer(actor: TaskActor, dto: AnswerTaskDto) {
    return this.tasks.answer(actor, dto);
  }

  // tasks.task.review
  taskReview(actor: TaskActor, taskId: string, dto: ReviewTaskDto) {
    return this.tasks.review(actor, taskId, dto);
  }

  // tasks.media.request-upload
  mediaRequestUpload(actor: MediaActor, dto: RequestUploadDto) {
    return this.media.requestUpload(actor, dto);
  }

  // tasks.media.get-url
  mediaGetUrl(actor: MediaActor, mediaId: string) {
    return this.media.getUrl(actor, mediaId);
  }
}
