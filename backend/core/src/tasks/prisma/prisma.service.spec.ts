import { PrismaPg } from '@prisma/adapter-pg';
import { TasksPrismaService } from './prisma.service';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../../config', () => ({
  envs: {
    tasksDatabaseUrl:
      'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('./generated/client', () => ({
  PrismaClient: class {
    constructor(readonly options: unknown) {}
    $connect = mockConnect;
    $disconnect = mockDisconnect;
  },
}));

describe('TasksPrismaService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the pg adapter for the schema named in TASKS_DATABASE_URL', () => {
    new TasksPrismaService();

    expect(PrismaPg).toHaveBeenCalledWith(
      {
        connectionString:
          'postgresql://tasks_svc:secret@localhost:5432/teamworkflow?schema=tasks',
      },
      { schema: 'tasks' },
    );
  });

  it('connects on module init', async () => {
    await new TasksPrismaService().onModuleInit();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    await new TasksPrismaService().onModuleDestroy();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
