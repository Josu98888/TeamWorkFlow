import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { envs } from '../../config';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config?: Partial<StorageConfig>) {
    const endpoint = config?.endpoint ?? envs.s3Endpoint;
    const region = config?.region ?? envs.s3Region;
    const accessKey = config?.accessKey ?? envs.s3AccessKey;
    const secretKey = config?.secretKey ?? envs.s3SecretKey;
    const forcePathStyle = config?.forcePathStyle ?? envs.s3ForcePathStyle;
    this.bucket = config?.bucket ?? envs.s3Bucket;

    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle,
    });
  }

  async getPresignedPutUrl(
    storageKey: string,
    mime: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: mime,
      ContentLength: sizeBytes,
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async getPresignedGetUrl(
    storageKey: string,
    ttlSeconds: number,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async checkObjectExistsAndSize(
    storageKey: string,
    expectedSizeBytes: number,
  ): Promise<boolean> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
        }),
      );

      return response.ContentLength === expectedSizeBytes;
    } catch (error) {
      this.logger.debug(
        `HeadObject check failed for key ${storageKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async deleteObjectsByPrefix(prefix: string): Promise<number> {
    let deletedCount = 0;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const objects = listResponse.Contents;
      if (objects && objects.length > 0) {
        const toDelete = objects
          .map((obj) => obj.Key)
          .filter((key): key is string => Boolean(key))
          .map((Key) => ({ Key }));

        if (toDelete.length > 0) {
          await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: { Objects: toDelete },
            }),
          );
          deletedCount += toDelete.length;
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return deletedCount;
  }
}
