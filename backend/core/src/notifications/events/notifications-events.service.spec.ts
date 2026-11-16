import type { JsMsg } from '@nats-io/jetstream';
import {
  MAX_DELIVERIES,
  NotificationsEventsService,
  handlerRetryDelayMs,
} from './notifications-events.service';

const makeMessage = (
  subject: string,
  payload: unknown,
  deliveryCount = 1,
) =>
  ({
    subject,
    info: { deliveryCount },
    json: jest.fn(() => payload),
    ack: jest.fn(),
    nak: jest.fn(),
    term: jest.fn(),
  }) as unknown as JsMsg & {
    ack: jest.Mock;
    nak: jest.Mock;
    term: jest.Mock;
  };

describe('NotificationsEventsService', () => {
  it('computes exponential backoff capped at 5 minutes', () => {
    expect(handlerRetryDelayMs(1)).toBe(5_000);
    expect(handlerRetryDelayMs(2)).toBe(10_000);
    expect(handlerRetryDelayMs(10)).toBe(300_000);
  });

  it('dispatches matching handler and acks on success', async () => {
    const service = new NotificationsEventsService({ servers: ['nats://127.0.0.1:4222'] });
    const handler = jest.fn(async () => undefined);
    service.registerHandler('t.*.notifications.send', handler);

    const msg = makeMessage('t.tenant-1.notifications.send', {
      eventId: 'evt-1',
      templateCode: 'billing_invoice_issued',
    });

    await service.dispatch(msg);

    expect(handler).toHaveBeenCalledWith({
      subject: 't.tenant-1.notifications.send',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-1',
        templateCode: 'billing_invoice_issued',
      },
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
  });

  it('naks when no handler matches the consumed subject', async () => {
    const service = new NotificationsEventsService({ servers: ['nats://127.0.0.1:4222'] });
    const msg = makeMessage('t.tenant-1.unknown.event', {});

    await service.dispatch(msg);

    expect(msg.nak).toHaveBeenCalledWith(30_000);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('naks with backoff on transient handler error and terms after MAX_DELIVERIES', async () => {
    const service = new NotificationsEventsService({ servers: ['nats://127.0.0.1:4222'] });
    service.registerHandler('t.*.tasks.task_assigned', async () => {
      throw new Error('transient db outage');
    });

    const retryMsg = makeMessage('t.tenant-1.tasks.task_assigned', {}, 2);
    await service.dispatch(retryMsg);
    expect(retryMsg.nak).toHaveBeenCalledWith(10_000);
    expect(retryMsg.term).not.toHaveBeenCalled();

    const dlqMsg = makeMessage(
      't.tenant-1.tasks.task_assigned',
      {},
      MAX_DELIVERIES,
    );
    await service.dispatch(dlqMsg);
    expect(dlqMsg.term).toHaveBeenCalledTimes(1);
    expect(dlqMsg.nak).not.toHaveBeenCalled();
  });
});
