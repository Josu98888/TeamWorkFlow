import { Injectable } from '@nestjs/common';
import { MediaNotUploadedException } from '../../common/exceptions/app.exceptions';
import { TasksPrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

@Injectable()
export class MediaVerificationService {
  constructor(
    private readonly prisma: TasksPrismaService,
    private readonly storage: StorageService,
  ) {}

  async verifyMediaForAnswer(
    tenantId: string,
    userId: string,
    mediaId: string,
  ): Promise<void> {
    const media = await this.prisma.media.findFirst({
      where: {
        id: mediaId,
        tenantId,
        uploadedByUserId: userId,
        status: 'PENDING',
      },
    });

    if (!media) {
      throw new MediaNotUploadedException();
    }

    const existsAndMatches = await this.storage.checkObjectExistsAndSize(
      media.storageKey,
      media.sizeBytes,
    );

    if (!existsAndMatches) {
      throw new MediaNotUploadedException();
    }

    const updated = await this.prisma.media.updateMany({
      where: {
        id: mediaId,
        tenantId,
        status: 'PENDING',
      },
      data: {
        status: 'UPLOADED',
      },
    });

    if (updated.count === 0) {
      throw new MediaNotUploadedException();
    }
  }
}
