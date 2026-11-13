const mockPrismaPg = jest.fn((poolCfg: unknown, opts: unknown) => ({
  poolCfg,
  opts,
}));
const mockConnect = jest.fn(async () => undefined);
const mockDisconnect = jest.fn(async () => undefined);

jest.mock('../../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: mockPrismaPg }));
jest.mock('./generated/client', () => ({
  PrismaClient: class {
    $connect = mockConnect;
    $disconnect = mockDisconnect;
    constructor(public readonly options: unknown) {}
  },
}));

import { NotificationsPrismaService, schemaFromUrl } from './prisma.service';

describe('NotificationsPrismaService', () => {
  beforeEach(() => {
    mockPrismaPg.mockClear();
    mockConnect.mockClear();
    mockDisconnect.mockClear();
  });

  it('extracts schema query param and falls back to notifications', () => {
    expect(
      schemaFromUrl('postgresql://u:p@localhost:5432/db?schema=custom_notif'),
    ).toBe('custom_notif');
    expect(schemaFromUrl('postgresql://u:p@localhost:5432/db')).toBe(
      'notifications',
    );
    expect(schemaFromUrl('not-a-valid-url')).toBe('notifications');
  });

  it('passes notificationsDatabaseUrl and explicit schema to PrismaPg and connects cleanly', async () => {
    const service = new NotificationsPrismaService();

    expect(mockPrismaPg).toHaveBeenCalledWith(
      {
        connectionString:
          'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
      },
      { schema: 'notifications' },
    );

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
