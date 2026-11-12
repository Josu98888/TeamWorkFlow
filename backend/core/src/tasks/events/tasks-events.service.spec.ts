import {
  JetStreamApiCodes,
  JetStreamApiError,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { TASKS_STREAM } from '../tasks.patterns';
import { TASKS_EVENTS } from './tasks.events';
import {
  TasksEventsService,
  MAX_DELIVERIES,
  handlerRetryDelayMs,
} from './tasks-events.service';

jest.mock('@nats-io/transport-node', () => ({ connect: jest.fn() }));
jest.mock('@nats-io/jetstream', () => ({
  ...jest.requireActual<object>('@nats-io/jetstream'),
  jetstream: jest.fn(),
  jetstreamManager: jest.fn(),
}));

function apiError(errCode: number) {
  return new JetStreamApiError({
    code: 404,
    err_code: errCode,
    description: 'not found',
  });
}

describe('TasksEventsService', () => {
  let service: TasksEventsService;
  let mockJs: { publish: jest.Mock; consumers: { get: jest.Mock } };
  let mockJsm: {
    streams: { update: jest.Mock; add: jest.Mock };
    consumers: { update: jest.Mock; add: jest.Mock };
  };

  beforeEach(() => {
    mockJs = {
      publish: jest.fn().mockResolvedValue({ seq: 1 }),
      consumers: {
        get: jest.fn().mockResolvedValue({
          consume: jest.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {},
            close: jest.fn(),
          }),
        }),
      },
    };
    mockJsm = {
      streams: { update: jest.fn().mockResolvedValue({}), add: jest.fn() },
      consumers: { update: jest.fn().mockResolvedValue({}), add: jest.fn() },
    };

    (connect as jest.Mock).mockResolvedValue({
      drain: jest.fn().mockResolvedValue(undefined),
    });
    (jetstream as jest.Mock).mockReturnValue(mockJs);
    (jetstreamManager as jest.Mock).mockResolvedValue(mockJsm);

    service = new TasksEventsService({
      servers: ['nats://localhost:4222'],
      retryInitialMs: 1,
      retryMaxMs: 2,
    });
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('creates the TASKS_EVENTS stream if not found and starts consumers', async () => {
    mockJsm.streams.update.mockRejectedValue(
      apiError(JetStreamApiCodes.StreamNotFound),
    );

    await service.onModuleInit();

    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: TASKS_STREAM }),
    );
    expect(mockJsm.consumers.update).toHaveBeenCalled();
  });

  it('publishes events with eventId and occurredAt', async () => {
    await service.onModuleInit();

    await service.publish('tenant-1', TASKS_EVENTS.taskCompleted, {
      taskId: 'task-1',
      employeeId: 'emp-1',
      siteId: 'site-1',
    });

    expect(mockJs.publish).toHaveBeenCalledWith(
      't.tenant-1.tasks.task_completed',
      expect.stringContaining('"taskId":"task-1"'),
      expect.objectContaining({ msgID: expect.any(String) as string }),
    );
  });

  it('calculates exponential backoff delay correctly up to max', () => {
    expect(handlerRetryDelayMs(1)).toBe(5000);
    expect(handlerRetryDelayMs(2)).toBe(10000);
    expect(handlerRetryDelayMs(3)).toBe(20000);
    expect(handlerRetryDelayMs(10)).toBe(300000);
    expect(MAX_DELIVERIES).toBe(20);
  });
});
