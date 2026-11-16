import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

jest.mock('../../config', () => ({
  envs: {
    s3Endpoint: 'http://localhost:9000',
    s3Region: 'us-east-1',
    s3Bucket: 'test-bucket',
    s3AccessKey: 'test-key',
    s3SecretKey: 'test-secret',
    s3ForcePathStyle: true,
  },
}));
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn();
    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));
    (getSignedUrl as jest.Mock).mockResolvedValue('https://s3.example.com/signed-url');

    service = new StorageService({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKey: 'test-key',
      secretKey: 'test-secret',
      forcePathStyle: true,
    });
  });

  it('generates presigned PUT URL with mime and size', async () => {
    const url = await service.getPresignedPutUrl('tenant/media1.jpg', 'image/jpeg', 1024, 300);

    expect(url).toBe('https://s3.example.com/signed-url');
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(PutObjectCommand),
      { expiresIn: 300 },
    );
  });

  it('verifies object exists and matches size via HeadObject', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 2048 });

    const existsAndMatches = await service.checkObjectExistsAndSize('tenant/media1.jpg', 2048);
    expect(existsAndMatches).toBe(true);

    mockSend.mockResolvedValueOnce({ ContentLength: 1000 });
    const sizeMismatch = await service.checkObjectExistsAndSize('tenant/media1.jpg', 2048);
    expect(sizeMismatch).toBe(false);

    mockSend.mockRejectedValueOnce(new Error('NotFound'));
    const notFound = await service.checkObjectExistsAndSize('tenant/media1.jpg', 2048);
    expect(notFound).toBe(false);
  });

  it('deletes objects by prefix in batches', async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: 'tenant-1/photo1.jpg' }, { Key: 'tenant-1/photo2.jpg' }],
        NextContinuationToken: undefined,
      })
      .mockResolvedValueOnce({}); // DeleteObjectsCommand

    const deletedCount = await service.deleteObjectsByPrefix('tenant-1/');

    expect(deletedCount).toBe(2);
    expect(mockSend).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
    expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectsCommand));
  });
});
