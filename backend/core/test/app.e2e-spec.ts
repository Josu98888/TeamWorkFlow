import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.config';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 { detail, code } for an unknown route under /api', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/unknown')
      .expect(404);

    expect(response.body).toEqual({
      detail: expect.any(String) as string,
      code: 'not_found',
    });
  });
});
