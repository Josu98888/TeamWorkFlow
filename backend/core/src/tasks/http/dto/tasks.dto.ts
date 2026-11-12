import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { FormFieldDefinition } from '../../domain/form-validator';
import type { DeadlineMode, TaskStatus } from '../../prisma/generated/client';

export class FormIdParamDto {
  @IsUUID('7', { message: 'formId must be a valid UUID' })
  formId!: string;
}

export class TemplateIdParamDto {
  @IsUUID('7', { message: 'id must be a valid UUID' })
  id!: string;
}

export class TaskIdParamDto {
  @IsUUID('7', { message: 'taskId must be a valid UUID' })
  taskId!: string;
}

export class MediaIdParamDto {
  @IsUUID('7', { message: 'mediaId must be a valid UUID' })
  mediaId!: string;
}

export class CreateFormBodyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @IsNotEmpty()
  fields!: FormFieldDefinition[];
}

export class UpdateFormBodyDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsOptional()
  fields?: FormFieldDefinition[];
}

export class CreateTaskTemplateBodyDto {
  @IsUUID('7')
  siteId!: string;

  @IsUUID('7')
  postId!: string;

  @IsUUID('7')
  formVersionId!: string;

  @IsString()
  @IsNotEmpty()
  deadlineMode!: DeadlineMode;

  @IsInt()
  @Min(1)
  @IsOptional()
  deadlineMinutes?: number;
}

export class UpdateTaskTemplateBodyDto {
  @IsUUID('7')
  @IsOptional()
  formVersionId?: string;

  @IsString()
  @IsOptional()
  deadlineMode?: DeadlineMode;

  @IsInt()
  @Min(1)
  @IsOptional()
  deadlineMinutes?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ListTemplatesQueryDto {
  @IsUUID('7')
  @IsOptional()
  siteId?: string;

  @IsUUID('7')
  @IsOptional()
  postId?: string;
}

export class CreateTaskBodyDto {
  @IsUUID('7')
  formVersionId!: string;

  @IsDateString()
  deadline!: string;

  @IsUUID('7')
  @IsOptional()
  employeeId?: string;

  @IsUUID('7')
  siteId!: string;

  @IsUUID('7')
  postId!: string;

  @IsString()
  @IsOptional()
  expectedQr?: string;

  @IsString()
  @IsOptional()
  title?: string;
}

export class AnswerTaskBodyDto {
  @IsString()
  @IsNotEmpty()
  clientAnswerId!: string;

  @IsDateString()
  deviceTime!: string;

  @IsNotEmpty()
  answers!: Record<string, unknown>;
}

export class ReviewTaskBodyDto {
  @IsEnum(['APPROVED', 'OBSERVED'])
  result!: 'APPROVED' | 'OBSERVED';

  @IsString()
  @IsOptional()
  note?: string;
}

export class ListTasksQueryDto {
  @IsString()
  @IsOptional()
  status?: TaskStatus;

  @IsUUID('7')
  @IsOptional()
  employeeId?: string;

  @IsUUID('7')
  @IsOptional()
  siteId?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  pageSize?: number;
}

export class RequestUploadBodyDto {
  @IsString()
  @IsNotEmpty()
  mime!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsString()
  @IsNotEmpty()
  sha256!: string;

  @IsDateString()
  takenAt!: string;
}
