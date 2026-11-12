import { PrismaPg } from '@prisma/adapter-pg';
import { AttendancePrismaService } from './attendance-prisma.service';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../config', () => ({
  envs: {
    attendanceDatabaseUrl:
      'postgresql://attendance_svc:secret@localhost:5432/teamworkflow?schema=attendance',
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

describe('AttendancePrismaService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the pg adapter for the schema named in ATTENDANCE_DATABASE_URL', () => {
    new AttendancePrismaService();

    expect(PrismaPg).toHaveBeenCalledWith(
      {
        connectionString:
          'postgresql://attendance_svc:secret@localhost:5432/teamworkflow?schema=attendance',
      },
      { schema: 'attendance' },
    );
  });

  it('connects on module init', async () => {
    await new AttendancePrismaService().onModuleInit();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    await new AttendancePrismaService().onModuleDestroy();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
