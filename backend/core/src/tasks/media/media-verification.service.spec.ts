jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
}));
jest.mock('../../config', () => ({
  envs: {
    s3Endpoint: 'http://localhost:9000',
    s3Region: 'us-east-1',
    s3Bucket: 'teamworkflow-tasks',
    s3AccessKey: 'minioadmin',
    s3SecretKey: 'minioadmin',
    s3ForcePathStyle: true,
    s3PresignPutTtlSec: 300,
    s3PresignGetTtlSec: 600,
  },
}));

import { MediaNotUploadedException } from '../../common/exceptions/app.exceptions';
import type { TasksPrismaService } from '../prisma/prisma.service';
import { MediaVerificationService } from './media-verification.service';
import type { StorageService } from './storage.service';

describe('MediaVerificationService', () => {
  let service: MediaVerificationService;
  let mockPrisma: {
    media: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockStorage: {
    checkObjectExistsAndSize: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      media: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    mockStorage = {
      checkObjectExistsAndSize: jest.fn(),
    };
    service = new MediaVerificationService(
      mockPrisma as unknown as TasksPrismaService,
      mockStorage as unknown as StorageService,
    );
  });

  it('updates pending media to UPLOADED when S3 object matches declared size', async () => {
    mockPrisma.media.findFirst.mockResolvedValue({
      id: 'media-1',
      tenantId: 'tenant-1',
      uploadedByUserId: 'user-1',
      storageKey: 'tenant-1/user-1/media-1.jpg',
      sizeBytes: 1024,
      status: 'PENDING',
    });
    mockStorage.checkObjectExistsAndSize.mockResolvedValue(true);
    mockPrisma.media.updateMany.mockResolvedValue({ count: 1 });

    await service.verifyMediaForAnswer('tenant-1', 'user-1', 'media-1');

    expect(mockPrisma.media.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'media-1',
        tenantId: 'tenant-1',
        uploadedByUserId: 'user-1',
        status: 'PENDING',
      },
    });
    expect(mockStorage.checkObjectExistsAndSize).toHaveBeenCalledWith(
      'tenant-1/user-1/media-1.jpg',
      1024,
    );
    expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'media-1',
        tenantId: 'tenant-1',
        status: 'PENDING',
      },
      data: { status: 'UPLOADED' },
    });
  });

  it('throws 422 MediaNotUploadedException when media row is missing, wrong user, or already UPLOADED', async () => {
    mockPrisma.media.findFirst.mockResolvedValue(null);

    await expect(
      service.verifyMediaForAnswer('tenant-1', 'other-user', 'media-1'),
    ).rejects.toThrow(MediaNotUploadedException);
    expect(mockStorage.checkObjectExistsAndSize).not.toHaveBeenCalled();
  });

  it('throws 422 MediaNotUploadedException when object is missing or wrong size in S3', async () => {
    mockPrisma.media.findFirst.mockResolvedValue({
      id: 'media-1',
      tenantId: 'tenant-1',
      uploadedByUserId: 'user-1',
      storageKey: 'tenant-1/user-1/media-1.jpg',
      sizeBytes: 1024,
      status: 'PENDING',
    });
    mockStorage.checkObjectExistsAndSize.mockResolvedValue(false);

    await expect(
      service.verifyMediaForAnswer('tenant-1', 'user-1', 'media-1'),
    ).rejects.toThrow(MediaNotUploadedException);
    expect(mockPrisma.media.updateMany).not.toHaveBeenCalled();
  });

  it('throws 422 MediaNotUploadedException if status changed concurrently before update', async () => {
    mockPrisma.media.findFirst.mockResolvedValue({
      id: 'media-1',
      tenantId: 'tenant-1',
      uploadedByUserId: 'user-1',
      storageKey: 'tenant-1/user-1/media-1.jpg',
      sizeBytes: 1024,
      status: 'PENDING',
    });
    mockStorage.checkObjectExistsAndSize.mockResolvedValue(true);
    mockPrisma.media.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.verifyMediaForAnswer('tenant-1', 'user-1', 'media-1'),
    ).rejects.toThrow(MediaNotUploadedException);
  });
});
