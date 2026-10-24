import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { InvalidTokenException } from '../src/common/exceptions/app.exceptions';
import { configureApp } from '../src/app.config';
import { AuthGuard } from '../src/http/guards/auth.guard';

// Smoke test without DB or NATS: the real HTTP stack (prefix, pipe, filter,
// global guard, auth controller) over a mocked AuthService facade. `AppModule`
// is not imported because it opens Prisma and NATS connections on boot; the
// full flow against real infrastructure is T6.6.
describe('App (e2e)', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(),
    logout: jest.fn(),
    verify: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: APP_GUARD, useClass: AuthGuard },
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

  it('returns 404 { detail, code } for an unknown route under /api', async () => {
    auth.verify.mockResolvedValue({ userId: 'u' });

    const response = await request(app.getHttpServer())
      .get('/api/unknown')
      .set('Authorization', 'Bearer t')
      .expect(404);

    expect(response.body).toEqual({
      detail: expect.any(String) as string,
      code: 'not_found',
    });
  });

  it('serves the public login route without a token', async () => {
    const pair = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };
    auth.login.mockResolvedValue(pair);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
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
      .post('/api/auth/login')
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
      .post('/api/auth/logout')
      .send({ refreshToken: 'r' })
      .expect(401);

    expect((response.body as { code: string }).code).toBe('invalid_token');
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('answers 401 when verify rejects the token', async () => {
    auth.verify.mockRejectedValue(new InvalidTokenException());

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer bad')
      .send({ refreshToken: 'r' })
      .expect(401);
  });

  it('serves a guarded route with a verified token', async () => {
    auth.verify.mockResolvedValue({ userId: 'u' });
    auth.logout.mockResolvedValue({ ok: true });

    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer good')
      .send({ refreshToken: 'r' })
      .expect(201);

    expect(response.body).toEqual({ ok: true });
    expect(auth.verify).toHaveBeenCalledWith({ accessToken: 'good' });
  });
});
