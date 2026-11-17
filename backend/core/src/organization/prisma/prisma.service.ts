import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildPgPoolConfig } from '../../common/prisma/pg-pool-config';
import { envs } from '../../config';
import { PrismaClient } from './generated/client';

const DEFAULT_SCHEMA = 'organization';

// The adapter does not read `?schema=` from the URL, so it is passed explicitly.
function schemaFromUrl(databaseUrl: string): string {
  return new URL(databaseUrl).searchParams.get('schema') ?? DEFAULT_SCHEMA;
}

@Injectable()
export class OrganizationPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrganizationPrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg(
        buildPgPoolConfig(envs.organizationDatabaseUrl, {
          max: envs.dbPoolMax,
          ssl: envs.dbSsl,
          sslCa: envs.dbSslCa,
        }),
        { schema: schemaFromUrl(envs.organizationDatabaseUrl) },
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
