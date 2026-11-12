import { Test, TestingModule } from '@nestjs/testing';
import { BillingConsumer } from './billing.handler';
import {
  ConsumedEventProcessor,
  PoisonEventError,
} from '../consumed-event.processor';
import { TenantStateService } from '../../tenants/tenant-state.service';

describe('BillingConsumer', () => {
  let consumer: BillingConsumer;

  const mockProcessor = {
    register: jest.fn(),
  };

  const mockTenantState = {
    updateFeatures: jest.fn(),
  };

  const mockTx = {
    alert: { deleteMany: jest.fn() },
    clockEventCorrection: { deleteMany: jest.fn() },
    clockEvent: { deleteMany: jest.fn() },
    workday: { deleteMany: jest.fn() },
    shiftSnapshot: { deleteMany: jest.fn() },
    tenantState: { deleteMany: jest.fn() },
    tenantFeatures: { deleteMany: jest.fn() },
    processedEvent: { deleteMany: jest.fn() },
  } as any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingConsumer,
        { provide: ConsumedEventProcessor, useValue: mockProcessor },
        { provide: TenantStateService, useValue: mockTenantState },
      ],
    }).compile();

    consumer = module.get<BillingConsumer>(BillingConsumer);
  });

  it('registers all billing filters on init', () => {
    consumer.onModuleInit();
    expect(mockProcessor.register).toHaveBeenCalledTimes(3);
  });

  describe('handleFeaturesUpdate', () => {
    it('updates tenant features for subscription_created', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.billing.subscription_created',
      )[0].handle;

      const date = new Date('2026-10-28T12:00:00Z');
      await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: date,
        payload: {
          plan: 'pro',
          features: { alerts: true, tower: true },
        },
        tx: mockTx,
      });

      expect(mockTenantState.updateFeatures).toHaveBeenCalledWith(
        'tenant-1',
        { alerts: true, tower: true },
        date,
        mockTx,
      );
    });

    it('updates tenant features for plan_changed with effectiveAt string', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.billing.plan_changed',
      )[0].handle;

      await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: {
          plan: 'basic',
          features: { alerts: false, tower: false },
          effectiveAt: '2026-10-28T14:00:00Z',
        },
        tx: mockTx,
      });

      expect(mockTenantState.updateFeatures).toHaveBeenCalledWith(
        'tenant-1',
        { alerts: false, tower: false },
        new Date('2026-10-28T14:00:00Z'),
        mockTx,
      );
    });

    it('throws PoisonEventError if features is not an object', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.billing.plan_changed',
      )[0].handle;

      await expect(
        handler({
          tenantId: 'tenant-1',
          eventId: 'event-1',
          occurredAt: new Date(),
          payload: { features: 'not-an-object' },
          tx: mockTx,
        }),
      ).rejects.toThrow(PoisonEventError);
    });
  });

  describe('handleDataRetentionExpired', () => {
    it('permanently deletes all tenant data in all 8 tables', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.billing.data_retention_expired',
      )[0].handle;

      await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: {},
        tx: mockTx,
      });

      expect(mockTx.alert.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.clockEventCorrection.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.clockEvent.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.workday.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.shiftSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.tenantState.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.tenantFeatures.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
      expect(mockTx.processedEvent.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
    });
  });
});
