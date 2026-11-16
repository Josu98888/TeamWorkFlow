import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { envs } from '../../config';
import { PrismaClient } from './generated/client';

const DEFAULT_SCHEMA = 'notifications';

// The adapter does not read `?schema=` from the URL, so it is passed explicitly.
export function schemaFromUrl(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).searchParams.get('schema') ?? DEFAULT_SCHEMA;
  } catch {
    return DEFAULT_SCHEMA;
  }
}

@Injectable()
export class NotificationsPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsPrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg(
        { connectionString: envs.notificationsDatabaseUrl },
        { schema: schemaFromUrl(envs.notificationsDatabaseUrl) },
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
