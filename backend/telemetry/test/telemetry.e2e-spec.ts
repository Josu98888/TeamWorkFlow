import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../src/app.config';
import { AuthGuard } from '../src/http/guards/auth.guard';
import { NatsClientService } from '../src/nats/nats-client.service';
import { JetStreamService } from '../src/nats/jetstream.service';
import { AttendancePrismaService } from '../src/prisma/attendance-prisma.service';
import { ClockInsController } from '../src/clock-ins/clock-ins.controller';
import { ClockInsService } from '../src/clock-ins/clock-ins.service';
import { WorkdaysController } from '../src/workdays/workdays.controller';
import { WorkdaysService } from '../src/workdays/workdays.service';
import { AlertsController } from '../src/alerts/alerts.controller';
import { AlertsService } from '../src/alerts/alerts.service';
import { TowerController } from '../src/tower/tower.controller';
import { TowerService } from '../src/tower/tower.service';
import { TenantStateService } from '../src/tenants/tenant-state.service';
import type { VerifiedActor } from '../src/nats/dto/nats-contracts';

describe('Telemetry E2E Integration', () => {
  let app: INestApplication;

  const mockNatsClient = {
    verifyToken: jest.fn(),
    resolveEmployeeId: jest.fn(),
    getSite: jest.fn(),
    getShift: jest.fn(),
  };

  const mockJetstream = {
    publish: jest.fn().mockResolvedValue(undefined),
    registerHandler: jest.fn(),
  };

  const mockClockInsService = {
    createClockEvent: jest.fn(),
    createManualClockEvent: jest.fn(),
    correctClockEvent: jest.fn(),
    listClockEvents: jest.fn(),
  };

  const mockWorkdaysService = {
    getWorkdayByShift: jest.fn(),
    listWorkdays: jest.fn(),
  };

  const mockAlertsService = {
    listAlerts: jest.fn().mockResolvedValue([]),
    acknowledgeAlert: jest.fn(),
    resolveAlert: jest.fn(),
  };

  const mockTowerService = {
    getSnapshot: jest.fn().mockResolvedValue([
      { siteId: 'site-1', expected: 2, present: 1, openAlerts: 0 },
    ]),
  };

  const mockTenantStateService = {
    isSuspended: jest.fn().mockResolvedValue(false),
    hasFeature: jest.fn().mockResolvedValue(true),
  };

  const mockPrisma = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ClockInsController,
        WorkdaysController,
        AlertsController,
        TowerController,
      ],
      providers: [
        { provide: NatsClientService, useValue: mockNatsClient },
        { provide: JetStreamService, useValue: mockJetstream },
        { provide: AttendancePrismaService, useValue: mockPrisma },
        { provide: ClockInsService, useValue: mockClockInsService },
        { provide: WorkdaysService, useValue: mockWorkdaysService },
        { provide: AlertsService, useValue: mockAlertsService },
        { provide: TowerService, useValue: mockTowerService },
        { provide: TenantStateService, useValue: mockTenantStateService },
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Global Routing and Security', () => {
    it('returns 401 when accessing without token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/telemetry/alerts')
        .expect(401);

      expect(response.body).toEqual({
        detail: 'Invalid or expired token',
        code: 'invalid_token',
      });
    });

    it('returns 404 for an unknown route under /api/v1/telemetry', async () => {
      const actor: VerifiedActor = {
        userId: 'u1',
        tenantId: 't1',
        role: 'admin',
        siteIds: [],
        tenantStatus: 'active',
        plan: 'pro',
        features: { tower: true, alerts: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      const response = await request(app.getHttpServer())
        .get('/api/v1/telemetry/non-existing')
        .set('Authorization', 'Bearer valid-jwt')
        .expect(404);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'not_found',
      });
    });
  });

  describe('ValidationPipe error formatting', () => {
    it('returns 422 with validation_error code on invalid DTO body', async () => {
      const actor: VerifiedActor = {
        userId: 'emp-user-1',
        tenantId: 't1',
        role: 'employee',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'basic',
        features: {},
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      const response = await request(app.getHttpServer())
        .post('/api/v1/telemetry/clock-events')
        .set('Authorization', 'Bearer valid-jwt')
        .send({
          // missing required fields: type, method, deviceTime, clientEventId
          invalidField: 'test',
        })
        .expect(422);

      expect(response.body).toMatchObject({
        code: 'validation_error',
        detail: expect.any(String),
      });
      expect(Array.isArray(response.body.errors)).toBe(true);
    });
  });

  describe('Role-based Access Control', () => {
    it('blocks employee from accessing supervisor alerts route with 403 forbidden', async () => {
      const actor: VerifiedActor = {
        userId: 'emp-user-1',
        tenantId: 't1',
        role: 'employee',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'pro',
        features: { alerts: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      const response = await request(app.getHttpServer())
        .get('/api/v1/telemetry/alerts')
        .set('Authorization', 'Bearer valid-jwt')
        .expect(403);

      expect(response.body).toEqual({
        detail: 'You are not allowed to perform this action',
        code: 'forbidden',
      });
    });

    it('blocks supervisor from accessing Tower snapshot if tower feature is missing', async () => {
      const actor: VerifiedActor = {
        userId: 'sup-user-1',
        tenantId: 't1',
        role: 'supervisor',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'basic',
        features: { tower: false },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      const response = await request(app.getHttpServer())
        .get('/api/v1/telemetry/tower/snapshot')
        .set('Authorization', 'Bearer valid-jwt')
        .expect(403);

      expect(response.body).toEqual({
        detail: 'The current plan does not include access to tower',
        code: 'feature_not_in_plan',
      });
    });
  });

  describe('Authorized Operations', () => {
    it('allows supervisor with tower feature to fetch Tower snapshot', async () => {
      const actor: VerifiedActor = {
        userId: 'sup-user-1',
        tenantId: 't1',
        role: 'supervisor',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'pro',
        features: { tower: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      const response = await request(app.getHttpServer())
        .get('/api/v1/telemetry/tower/snapshot')
        .set('Authorization', 'Bearer valid-jwt')
        .expect(200);

      expect(response.body).toEqual([
        { siteId: 'site-1', expected: 2, present: 1, openAlerts: 0 },
      ]);
      expect(mockTowerService.getSnapshot).toHaveBeenCalledWith(actor);
    });

    it('allows supervisor with alerts feature to fetch alerts list', async () => {
      const actor: VerifiedActor = {
        userId: 'sup-user-1',
        tenantId: 't1',
        role: 'supervisor',
        siteIds: ['site-1'],
        tenantStatus: 'active',
        plan: 'pro',
        features: { alerts: true },
      };
      mockNatsClient.verifyToken.mockResolvedValue(actor);

      const response = await request(app.getHttpServer())
        .get('/api/v1/telemetry/alerts')
        .set('Authorization', 'Bearer valid-jwt')
        .expect(200);

      expect(response.body).toEqual([]);
      expect(mockAlertsService.listAlerts).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
    });
  });
});
