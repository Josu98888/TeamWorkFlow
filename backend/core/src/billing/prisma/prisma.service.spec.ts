import { PrismaPg } from '@prisma/adapter-pg';
import { BillingPrismaService } from './prisma.service';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../../config', () => ({
  envs: {
    billingDatabaseUrl:
      'postgresql://billing_svc:secret@localhost:5432/teamworkflow?schema=billing',
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

describe('BillingPrismaService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the pg adapter for the schema named in BILLING_DATABASE_URL', () => {
    new BillingPrismaService();

    expect(PrismaPg).toHaveBeenCalledWith(
      {
        connectionString:
          'postgresql://billing_svc:secret@localhost:5432/teamworkflow?schema=billing',
      },
      { schema: 'billing' },
    );
  });

  it('connects on module init', async () => {
    await new BillingPrismaService().onModuleInit();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    await new BillingPrismaService().onModuleDestroy();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
