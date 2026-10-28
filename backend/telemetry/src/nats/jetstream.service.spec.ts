import { JetStreamService } from './jetstream.service';

const mockPublish = jest.fn();
const mockStreamsInfo = jest.fn();
const mockStreamsAdd = jest.fn();

jest.mock('@nats-io/transport-node', () => ({
  connect: jest.fn().mockImplementation(() =>
    Promise.resolve({
      drain: jest.fn(),
    }),
  ),
}));

jest.mock('@nats-io/jetstream', () => ({
  jetstream: () => ({
    publish: mockPublish,
  }),
  jetstreamManager: () => ({
    streams: {
      info: mockStreamsInfo,
      add: mockStreamsAdd,
    },
  }),
  RetentionPolicy: { Limits: 'limits' },
  StorageType: { File: 'file' },
}));

describe('JetStreamService', () => {
  let service: JetStreamService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JetStreamService();
  });

  it('initializes connection and creates stream if missing', async () => {
    mockStreamsInfo.mockRejectedValueOnce(new Error('Stream not found'));
    await service.onModuleInit();

    expect(mockStreamsAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ATTENDANCE_EVENTS',
        subjects: ['t.*.attendance.>'],
      }),
    );
  });

  it('publishes event with auto-generated eventId and occurredAt', async () => {
    await service.onModuleInit();
    await service.publish('tenant-1', 'clock_event_recorded', {
      siteId: 'site-1',
    });

    expect(mockPublish).toHaveBeenCalledWith(
      't.tenant-1.attendance.clock_event_recorded',
      expect.any(String),
      expect.objectContaining({ msgID: expect.any(String) }),
    );
  });
});
