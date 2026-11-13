import { AUTH_PATTERNS } from '../../src/auth/auth.patterns';
import type { TokenPair } from '../../src/auth/token.service';
import type { VerifiedActor } from '../../src/auth/verified-actor';
import { NotificationsEventsService } from '../../src/notifications/events/notifications-events.service';
import { NOTIFICATIONS_EVENTS } from '../../src/notifications/events/notifications.events';
import { DeliveryRetryJob } from '../../src/notifications/jobs/delivery-retry.job';
import { FakeFcmProviderService } from '../../src/notifications/providers/fake-fcm-provider.service';
import { bearer, CoreE2eApp, startCoreApp } from '../support/core-app';
import {
  cleanDatabase,
  closeDatabase,
  notificationsDb,
} from '../support/database';

interface Member {
  tokens: TokenPair;
  actor: VerifiedActor;
}

async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('Notifications E2E Suite', () => {
  let core: CoreE2eApp;
  let fakeFcm: FakeFcmProviderService;
  let events: NotificationsEventsService;
  let retryJob: DeliveryRetryJob;

  beforeAll(async () => {
    core = await startCoreApp();
    fakeFcm = core.app.get(FakeFcmProviderService);
    events = core.app.get(NotificationsEventsService);
    retryJob = core.app.get(DeliveryRetryJob);
  });

  beforeEach(async () => {
    await cleanDatabase();
    fakeFcm.clear();
  });

  afterAll(async () => {
    await core?.close();
    await closeDatabase();
  });

  async function toMember(tokens: TokenPair): Promise<Member> {
    const actor = await core.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: tokens.accessToken,
    });
    return { tokens, actor };
  }

  async function registerOwner(tag: string): Promise<Member> {
    const res = await core
      .http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Notif Tenant ${tag}`,
        name: `Owner ${tag}`,
        email: `notif-owner-${tag}@test.local`,
        password: 'secure-password-123',
      })
      .expect(201);

    return toMember(res.body as TokenPair);
  }

  async function addMember(
    owner: Member,
    email: string,
    role: 'admin' | 'supervisor' | 'employee',
  ): Promise<Member> {
    const inv = (
      await core
        .http()
        .post('/api/v1/auth/invitations')
        .set('Authorization', bearer(owner.tokens))
        .send({ email, role })
        .expect(201)
    ).body as { token: string };

    const accepted = await core
      .http()
      .post('/api/v1/auth/invitations/accept')
      .send({
        token: inv.token,
        name: `Member ${role}`,
        password: 'secure-password-123',
      })
      .expect(201);

    return toMember(accepted.body as TokenPair);
  }

  it('rejects unauthenticated requests to push-tokens and notifications', async () => {
    await core
      .http()
      .post('/api/v1/push-tokens')
      .send({ token: 'tok', platform: 'android' })
      .expect(401);

    await core.http().get('/api/v1/notifications').expect(401);
    await core.http().get('/api/v1/notifications/unread-count').expect(401);
  });

  it('registers, reassigns, and strictly scopes push token unregistration', async () => {
    const owner = await registerOwner('tokens');
    const emp = await addMember(owner, 'emp-tok@test.local', 'employee');

    const reg1 = await core
      .http()
      .post('/api/v1/push-tokens')
      .set('Authorization', bearer(owner.tokens))
      .send({ token: 'shared-device-token-123', platform: 'android' })
      .expect(201);

    expect(reg1.body).toEqual({
      id: expect.any(String),
      platform: 'android',
      isActive: true,
      lastSeenAt: expect.any(String),
    });
    expect(JSON.stringify(reg1.body)).not.toContain('shared-device-token-123');

    await core
      .http()
      .post('/api/v1/push-tokens')
      .set('Authorization', bearer(owner.tokens))
      .send({ token: '   ', platform: 'android' })
      .expect(422);

    // Same device reused by another user reassigns ownership cleanly.
    await core
      .http()
      .post('/api/v1/push-tokens')
      .set('Authorization', bearer(emp.tokens))
      .send({ token: 'shared-device-token-123', platform: 'ios' })
      .expect(201);

    // Previous user cannot unregister someone else's token.
    const foreignUnreg = await core
      .http()
      .delete('/api/v1/push-tokens')
      .set('Authorization', bearer(owner.tokens))
      .send({ token: 'shared-device-token-123' })
      .expect(200);
    expect(foreignUnreg.body).toEqual({ unregistered: false });

    const ownUnreg = await core
      .http()
      .delete('/api/v1/push-tokens')
      .set('Authorization', bearer(emp.tokens))
      .send({ token: 'shared-device-token-123' })
      .expect(200);
    expect(ownUnreg.body).toEqual({ unregistered: true });
  });

  it('delivers JetStream notifications idempotently, supports in-app lifecycle, and isolates tenants', async () => {
    const ownerA = await registerOwner('iso-a');
    const ownerB = await registerOwner('iso-b');
    const empA = await addMember(ownerA, 'emp-a@test.local', 'employee');

    await core
      .http()
      .post('/api/v1/push-tokens')
      .set('Authorization', bearer(ownerA.tokens))
      .send({ token: 'fcm-owner-a-tok', platform: 'android' })
      .expect(201);

    const tenantId = ownerA.actor.tenantId!;
    const billingEventId = 'evt-e2e-billing-1';

    await events.publish(
      tenantId,
      NOTIFICATIONS_EVENTS.send,
      {
        tenantId,
        recipientUserIds: [],
        templateCode: 'billing_invoice_issued',
        data: {
          invoiceId: 'inv-1',
          period: '2026-11',
          total: '5000.00',
          dueDate: '2026-11-25',
        },
      },
      billingEventId,
    );

    const firstRow = await waitFor(async () => {
      const { rows } = await notificationsDb().query<{ id: string }>(
        `SELECT id FROM notifications.notifications
         WHERE tenant_id = $1 AND user_id = $2 AND source_event_id = $3`,
        [tenantId, ownerA.actor.userId, billingEventId],
      );
      return rows[0];
    });

    await waitFor(async () =>
      fakeFcm
        .getSentMessages()
        .find((m) => m.token === 'fcm-owner-a-tok'),
    );

    // Duplicate event delivery must not create duplicate notification rows.
    await events.publish(
      tenantId,
      NOTIFICATIONS_EVENTS.send,
      {
        tenantId,
        recipientUserIds: [],
        templateCode: 'billing_invoice_issued',
        data: { invoiceId: 'inv-1' },
      },
      billingEventId,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Second distinct notification for ownerA.
    await events.publish(
      tenantId,
      NOTIFICATIONS_EVENTS.send,
      {
        tenantId,
        recipientUserIds: [ownerA.actor.userId],
        templateCode: 'billing_due_soon',
        data: { invoiceId: 'inv-1', dueDate: '2026-11-25' },
      },
      'evt-e2e-billing-2',
    );

    const listRes = await waitFor(async () => {
      const res = await core
        .http()
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', bearer(ownerA.tokens))
        .expect(200);
      const body = res.body as { total: number; items: { id: string }[] };
      return body.total === 2 ? body : null;
    });

    expect(listRes.items).toHaveLength(2);

    const unreadBefore = await core
      .http()
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', bearer(ownerA.tokens))
      .expect(200);
    expect(unreadBefore.body).toEqual({ count: 2 });

    // Other user in same tenant and owner in another tenant get 404.
    await core
      .http()
      .post(`/api/v1/notifications/${firstRow.id}/read`)
      .set('Authorization', bearer(empA.tokens))
      .expect(404);

    await core
      .http()
      .post(`/api/v1/notifications/${firstRow.id}/read`)
      .set('Authorization', bearer(ownerB.tokens))
      .expect(404);

    // Owner marks one read, then marks all remaining read.
    await core
      .http()
      .post(`/api/v1/notifications/${firstRow.id}/read`)
      .set('Authorization', bearer(ownerA.tokens))
      .expect(201);

    const unreadMid = await core
      .http()
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', bearer(ownerA.tokens))
      .expect(200);
    expect(unreadMid.body).toEqual({ count: 1 });

    await core
      .http()
      .post('/api/v1/notifications/all/read')
      .set('Authorization', bearer(ownerA.tokens))
      .expect(201);

    const unreadAfter = await core
      .http()
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', bearer(ownerA.tokens))
      .expect(200);
    expect(unreadAfter.body).toEqual({ count: 0 });
  });

  it('retries failed FCM deliveries via DeliveryRetryJob and deactivates unregistered tokens', async () => {
    const owner = await registerOwner('retry');
    const tenantId = owner.actor.tenantId!;

    await core
      .http()
      .post('/api/v1/push-tokens')
      .set('Authorization', bearer(owner.tokens))
      .send({ token: 'flaky-tok', platform: 'android' })
      .expect(201);

    await core
      .http()
      .post('/api/v1/push-tokens')
      .set('Authorization', bearer(owner.tokens))
      .send({ token: 'dead-tok', platform: 'ios' })
      .expect(201);

    fakeFcm.simulateFailure('flaky-tok', 'messaging/unavailable');
    fakeFcm.simulateUnregistered('dead-tok');

    await events.publish(
      tenantId,
      NOTIFICATIONS_EVENTS.send,
      {
        tenantId,
        recipientUserIds: [owner.actor.userId],
        templateCode: 'billing_suspended',
        data: { invoiceId: 'inv-2' },
      },
      'evt-e2e-retry-1',
    );

    await waitFor(async () => {
      const { rows } = await notificationsDb().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM notifications.notification_deliveries
         WHERE tenant_id = $1 AND channel = 'PUSH' AND status = 'FAILED'`,
        [tenantId],
      );
      return rows[0]?.count === '2' ? true : null;
    });

    // Unregistered token must already be deactivated.
    const deadTokenRow = await notificationsDb().query<{ is_active: boolean }>(
      `SELECT is_active FROM notifications.device_tokens WHERE token = $1`,
      ['dead-tok'],
    );
    expect(deadTokenRow.rows[0]?.is_active).toBe(false);

    // Clear transient failure and trigger retry cron logic directly.
    fakeFcm.clear();
    const retriedSuccess = await retryJob.retryFailedDeliveries();
    expect(retriedSuccess).toBe(1);

    const flakySent = await notificationsDb().query<{
      status: string;
      attempts: number;
    }>(
      `SELECT d.status, d.attempts
       FROM notifications.notification_deliveries d
       JOIN notifications.device_tokens dt ON dt.id = d.device_token_id
       WHERE dt.token = $1`,
      ['flaky-tok'],
    );
    expect(flakySent.rows[0]).toEqual({ status: 'SENT', attempts: 2 });
  });
});
