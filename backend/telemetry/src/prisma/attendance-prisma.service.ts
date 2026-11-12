import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { envs } from '../config';
import { PrismaClient } from './generated/client';

const DEFAULT_SCHEMA = 'attendance';

function schemaFromUrl(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).searchParams.get('schema') ?? DEFAULT_SCHEMA;
  } catch {
    return DEFAULT_SCHEMA;
  }
}

@Injectable()
export class AttendancePrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AttendancePrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg(
        { connectionString: envs.attendanceDatabaseUrl },
        { schema: schemaFromUrl(envs.attendanceDatabaseUrl) },
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Attendance database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
