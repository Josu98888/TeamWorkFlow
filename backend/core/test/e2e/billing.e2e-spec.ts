import type { TokenPair } from '../../src/auth/token.service';
import { bearer, CoreE2eApp, startCoreApp } from '../support/core-app';
import { cleanDatabase, closeDatabase } from '../support/database';

describe('Billing E2E suite', () => {
  let core: CoreE2eApp;

  beforeAll(async () => {
    core = await startCoreApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await core?.close();
    await closeDatabase();
  });

  async function registerOwner(tag: string): Promise<TokenPair> {
    const response = await core
      .http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Billing Tenant ${tag}`,
        name: `Owner ${tag}`,
        email: `billing-owner-${tag}@test.local`,
        password: 'secure-password-123',
      })
      .expect(201);
    return response.body as TokenPair;
  }

  describe('Unauthenticated access', () => {
    it('rejects unauthenticated requests to tenant billing routes with 401 invalid_token', async () => {
      const response = await core
        .http()
        .get('/api/v1/billing/plans')
        .expect(401);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'invalid_token',
      });
    });

    it('allows public access to Mercado Pago webhook without token', async () => {
      const response = await core
        .http()
        .post('/api/v1/webhooks/mercadopago')
        .set('x-signature', 'ts=123,v1=test')
        .set('x-request-id', 'req-123')
        .send({
          id: '12345',
          action: 'payment.created',
          type: 'payment',
          data: { id: '99999' },
        })
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });
  });

  describe('Tenant Billing Routes', () => {
    it('allows owner to list plans', async () => {
      const tokens = await registerOwner('a');
      const response = await core
        .http()
        .get('/api/v1/billing/plans')
        .set(bearer(tokens.accessToken))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
    });

    it('rejects regular tenant actor from platform admin billing routes with 403 forbidden', async () => {
      const tokens = await registerOwner('b');
      const response = await core
        .http()
        .get('/api/v1/billing/admin/subscriptions')
        .set(bearer(tokens.accessToken))
        .expect(403);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'forbidden',
      });
    });
  });
});
