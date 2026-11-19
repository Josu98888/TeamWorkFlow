import { Injectable } from '@nestjs/common';
import { generateUuidV7 } from '../../common/uuidv7';
import {
  MediaNotFoundException,
  MediaTooLargeException,
  MediaTypeNotAllowedException,
} from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import { TasksPrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

export const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const EXTENSION_MAP: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface RequestUploadDto {
  mime: string;
  sizeBytes: number;
  sha256: string;
  takenAt: string | Date;
}

export interface MediaActor {
  userId: string;
  tenantId: string;
  role: string;
  siteIds?: string[];
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: TasksPrismaService,
    private readonly storage: StorageService,
  ) {}

  async requestUpload(actor: MediaActor, dto: RequestUploadDto) {
    if (dto.sizeBytes > MAX_MEDIA_SIZE_BYTES) {
      throw new MediaTooLargeException();
    }

    if (!ALLOWED_MIME_TYPES.includes(dto.mime as AllowedMimeType)) {
      throw new MediaTypeNotAllowedException();
    }

    const mime = dto.mime as AllowedMimeType;
    const ext = EXTENSION_MAP[mime];
    const mediaId = generateUuidV7();
    const storageKey = `${actor.tenantId}/${mediaId}.${ext}`;
    const ttlSeconds = envs.mediaUrlTtlSeconds ?? 300;

    const [media, uploadUrl] = await Promise.all([
      this.prisma.media.create({
        data: {
          id: mediaId,
          tenantId: actor.tenantId,
          storageKey,
          mime,
          sizeBytes: dto.sizeBytes,
          sha256: dto.sha256,
          takenAt: new Date(dto.takenAt),
          uploadedByUserId: actor.userId,
          status: 'PENDING',
        },
      }),
      this.storage.getPresignedPutUrl(
        storageKey,
        mime,
        dto.sizeBytes,
        ttlSeconds,
      ),
    ]);

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    return {
      mediaId: media.id,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getUrl(actor: MediaActor, mediaId: string) {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, tenantId: actor.tenantId },
    });

    if (!media) {
      throw new MediaNotFoundException();
    }

    const ttlSeconds = envs.mediaUrlTtlSeconds ?? 300;
    const url = await this.storage.getPresignedGetUrl(
      media.storageKey,
      ttlSeconds,
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    return {
      url,
      expiresAt: expiresAt.toISOString(),
    };
  }

}
