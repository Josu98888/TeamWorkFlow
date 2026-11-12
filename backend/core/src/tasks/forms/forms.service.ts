import { Injectable } from '@nestjs/common';
import { FormNotFoundException } from '../../common/exceptions/app.exceptions';
import { TasksPrismaService } from '../prisma/prisma.service';
import { validateFormFields, type FormFieldDefinition } from '../domain/form-validator';

export interface CreateFormDto {
  name: string;
  fields: FormFieldDefinition[];
}

export interface UpdateFormDto {
  name?: string;
  fields?: FormFieldDefinition[];
}

export interface FormActor {
  userId: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class FormsService {
  constructor(private readonly prisma: TasksPrismaService) {}

  async create(actor: FormActor, dto: CreateFormDto) {
    const validatedFields = validateFormFields(dto.fields);

    return this.prisma.form.create({
      data: {
        tenantId: actor.tenantId,
        name: dto.name.trim(),
        draftFields: validatedFields as unknown as object,
        createdBy: actor.userId,
      },
    });
  }

  async update(actor: FormActor, formId: string, dto: UpdateFormDto) {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, tenantId: actor.tenantId },
    });

    if (!form) {
      throw new FormNotFoundException();
    }

    const data: { name?: string; draftFields?: object } = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.fields !== undefined) {
      data.draftFields = validateFormFields(dto.fields) as unknown as object;
    }

    return this.prisma.form.update({
      where: { id: formId },
      data,
    });
  }

  async publish(actor: FormActor, formId: string) {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, tenantId: actor.tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!form) {
      throw new FormNotFoundException();
    }

    const latestVersion = form.versions[0]?.version ?? 0;
    const nextVersion = latestVersion + 1;

    return this.prisma.formVersion.create({
      data: {
        tenantId: actor.tenantId,
        formId: form.id,
        version: nextVersion,
        name: form.name,
        fields: form.draftFields as object,
        publishedBy: actor.userId,
      },
    });
  }

  async get(actor: FormActor, formId: string) {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, tenantId: actor.tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!form) {
      throw new FormNotFoundException();
    }

    return form;
  }

  async list(actor: FormActor, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where = { tenantId: actor.tenantId };

    const [items, total] = await Promise.all([
      this.prisma.form.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.form.count({ where }),
    ]);

    return { items, total };
  }
}
