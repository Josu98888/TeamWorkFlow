import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from './prisma.service';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../../config', () => ({
  envs: {
    authDatabaseUrl:
      'postgresql://auth_svc:secret@localhost:5432/teamworkflow?schema=auth',
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

// Covers: S2.6
describe('PrismaService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the pg adapter for the schema named in AUTH_DATABASE_URL', () => {
    new PrismaService();

    expect(PrismaPg).toHaveBeenCalledWith(
      {
        connectionString:
          'postgresql://auth_svc:secret@localhost:5432/teamworkflow?schema=auth',
      },
      { schema: 'auth' },
    );
  });

  it('connects on module init', async () => {
    await new PrismaService().onModuleInit();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    await new PrismaService().onModuleDestroy();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
