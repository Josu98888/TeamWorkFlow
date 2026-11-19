jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
    mediaUrlTtlSeconds: 300,
  },
}));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

import {
  MediaNotFoundException,
  MediaTooLargeException,
  MediaTypeNotAllowedException,
} from '../../common/exceptions/app.exceptions';
import { MediaService, type MediaActor } from './media.service';
import type { TasksPrismaService } from '../prisma/prisma.service';
import type { StorageService } from './storage.service';

describe('MediaService', () => {
  let service: MediaService;
  let mockPrisma: {
    media: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let mockStorage: {
    getPresignedPutUrl: jest.Mock;
    getPresignedGetUrl: jest.Mock;
    checkObjectExistsAndSize: jest.Mock;
  };

  const actor: MediaActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'employee',
  };

  beforeEach(() => {
    mockPrisma = {
      media: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    mockStorage = {
      getPresignedPutUrl: jest.fn().mockResolvedValue('https://s3.example.com/put'),
      getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3.example.com/get'),
      checkObjectExistsAndSize: jest.fn().mockResolvedValue(true),
    };

    service = new MediaService(
      mockPrisma as unknown as TasksPrismaService,
      mockStorage as unknown as StorageService,
    );
  });

  it('generates presigned upload URL for valid photo request', async () => {
    mockPrisma.media.create.mockImplementation(({ data }) => Promise.resolve(data));

    const result = await service.requestUpload(actor, {
      mime: 'image/jpeg',
      sizeBytes: 2048,
      sha256: 'abc123hash',
      takenAt: '2026-11-12T12:00:00.000Z',
    });

    expect(result.mediaId).toBeDefined();
    expect(result.uploadUrl).toBe('https://s3.example.com/put');
    expect(mockStorage.getPresignedPutUrl).toHaveBeenCalledWith(
      expect.stringContaining('tenant-1/'),
      'image/jpeg',
      2048,
      300,
    );
  });

  it('rejects oversized files with MediaTooLargeException', async () => {
    await expect(
      service.requestUpload(actor, {
        mime: 'image/jpeg',
        sizeBytes: 15 * 1024 * 1024,
        sha256: 'hash',
        takenAt: '2026-11-12T12:00:00.000Z',
      }),
    ).rejects.toThrow(MediaTooLargeException);
  });

  it('rejects forbidden mime types with MediaTypeNotAllowedException', async () => {
    await expect(
      service.requestUpload(actor, {
        mime: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'hash',
        takenAt: '2026-11-12T12:00:00.000Z',
      }),
    ).rejects.toThrow(MediaTypeNotAllowedException);
  });

  it('gets presigned read URL and enforces tenant isolation', async () => {
    mockPrisma.media.findFirst.mockResolvedValueOnce(null);
    await expect(service.getUrl(actor, 'missing-id')).rejects.toThrow(
      MediaNotFoundException,
    );

    mockPrisma.media.findFirst.mockResolvedValueOnce({
      id: 'm1',
      tenantId: actor.tenantId,
      storageKey: 'tenant-1/m1.jpg',
    });

    const res = await service.getUrl(actor, 'm1');
    expect(res.url).toBe('https://s3.example.com/get');
  });
});
