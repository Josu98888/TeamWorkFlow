import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { InvalidTokenException } from '../src/common/exceptions/app.exceptions';
import { configureApp } from '../src/app.config';
import type { AuthenticatedRequest } from '../src/http/authenticated-request';
import { AuthGuard } from '../src/http/guards/auth.guard';
import { AppThrottlerGuard } from '../src/http/guards/throttler.guard';
import { HealthController } from '../src/http/health/health.controller';

// Smoke test without DB or NATS: the real HTTP stack (prefix, pipe, filter,
// helmet, cors, trust proxy, global auth + throttler guards, auth controller)
// over a mocked AuthService facade.
describe('App (e2e)', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(),
    logout: jest.fn(),
    verify: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 60_000,
            limit: (context) => {
              const req = context
                .switchToHttp()
                .getRequest<Partial<AuthenticatedRequest>>();
              return req.actor?.userId ? 3 : 30;
            },
          },
        ]),
      ],
      controllers: [AuthController, HealthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.resetAllMocks());

  it('returns 404 { detail, code } for an unknown route under /api/v1', async () => {
    auth.verify.mockResolvedValue({ userId: 'u' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/unknown')
      .set('Authorization', 'Bearer t')
      .expect(404);

    expect(response.body).toEqual({
      detail: expect.any(String) as string,
      code: 'not_found',
    });
  });

  it('does not register /api/v1/telemetry (owned by the telemetry service)', async () => {
    auth.verify.mockResolvedValue({ userId: 'u' });

    await request(app.getHttpServer())
      .get('/api/v1/telemetry/ping')
      .set('Authorization', 'Bearer t')
      .expect(404);
  });

  it('serves the public login route without a token', async () => {
    const pair = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };
    auth.login.mockResolvedValue(pair);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'Ana@Acme.test', password: 'secret' })
      .expect(201);

    expect(response.body).toEqual(pair);
    expect(auth.login).toHaveBeenCalledWith({
      email: 'ana@acme.test',
      password: 'secret',
    });
  });

  it('answers 422 validation_error for an invalid or extra body field', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'ana@acme.test',
        password: 'secret',
        actor: { role: 'owner' },
      })
      .expect(422);

    expect((response.body as { code: string }).code).toBe('validation_error');
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('answers 401 invalid_token on a guarded route without a token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'r' })
      .expect(401);

    expect((response.body as { code: string }).code).toBe('invalid_token');
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('answers 401 when verify rejects the token', async () => {
    auth.verify.mockRejectedValue(new InvalidTokenException());

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer bad')
      .send({ refreshToken: 'r' })
      .expect(401);
  });

  it('serves a guarded route with a verified token', async () => {
    auth.verify.mockResolvedValue({ userId: 'u' });
    auth.logout.mockResolvedValue({ ok: true });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer good')
      .send({ refreshToken: 'r' })
      .expect(201);

    expect(response.body).toEqual({ ok: true });
    expect(auth.verify).toHaveBeenCalledWith({ accessToken: 'good' });
  });

  it('sets Helmet security headers (CSP, nosniff, frameguard) and removes X-Powered-By', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('enables CORS for WEB_ORIGIN with credentials and X-CSRF-Token preflight', async () => {
    const preflight = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3002')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type,X-CSRF-Token')
      .expect(204);

    expect(preflight.headers['access-control-allow-origin']).toBe(
      'http://localhost:3002',
    );
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'X-CSRF-Token',
    );
  });

  it('rate limits brute-force login attempts per client IP using trust proxy (X-Forwarded-For)', async () => {
    const pair = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };
    auth.login.mockResolvedValue(pair);

    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.42')
        .send({ email: 'ana@acme.test', password: 'secret' })
        .expect(201);
    }

    const throttled = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.42')
      .send({ email: 'ana@acme.test', password: 'secret' })
      .expect(429);

    expect(throttled.body).toEqual({
      detail: 'Too many requests, please try again later',
      code: 'rate_limited',
    });

    // A different client IP behind the proxy is not blocked
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ email: 'ana@acme.test', password: 'secret' })
      .expect(201);
  });

  it('rate limits authenticated routes per userId across different client IPs', async () => {
    auth.verify.mockResolvedValue({ userId: 'throttled-user-1' });
    auth.logout.mockResolvedValue({ ok: true });

    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer good')
        .set('X-Forwarded-For', `198.51.100.${10 + i}`)
        .send({ refreshToken: 'r' })
        .expect(201);
    }

    const throttled = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer good')
      .set('X-Forwarded-For', '198.51.100.50')
      .send({ refreshToken: 'r' })
      .expect(429);

    expect(throttled.body).toEqual({
      detail: 'Too many requests, please try again later',
      code: 'rate_limited',
    });
  });
});
