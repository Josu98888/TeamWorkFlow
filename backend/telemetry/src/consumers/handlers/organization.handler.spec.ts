import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationConsumer } from './organization.handler';
import {
  ConsumedEventProcessor,
  PoisonEventError,
} from '../consumed-event.processor';
import { ShiftSnapshotService } from '../../shifts/shift-snapshot.service';
import { WorkdaysService } from '../../workdays/workdays.service';
import { SiteCacheService } from '../../geofence/site-cache.service';
import { TowerService } from '../../tower/tower.service';

describe('OrganizationConsumer', () => {
  let consumer: OrganizationConsumer;

  const mockProcessor = {
    register: jest.fn(),
  };

  const mockShifts = {
    upsertShift: jest.fn(),
    updateShiftStatus: jest.fn(),
    getShift: jest.fn(),
  };

  const mockWorkdays = {
    recomputeWorkday: jest.fn(),
  };

  const mockSiteCache = {
    invalidateSite: jest.fn(),
  };

  const mockTower = {
    emitSiteSummaryUpdated: jest.fn(),
  };

  const mockTx = {} as any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationConsumer,
        { provide: ConsumedEventProcessor, useValue: mockProcessor },
        { provide: ShiftSnapshotService, useValue: mockShifts },
        { provide: WorkdaysService, useValue: mockWorkdays },
        { provide: SiteCacheService, useValue: mockSiteCache },
        { provide: TowerService, useValue: mockTower },
      ],
    }).compile();

    consumer = module.get<OrganizationConsumer>(OrganizationConsumer);
  });

  it('registers all organization filters on init', () => {
    consumer.onModuleInit();
    expect(mockProcessor.register).toHaveBeenCalledTimes(7);
  });

  describe('handleShiftUpsert', () => {
    it('upserts shift snapshot and returns site summary post-commit effect', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.organization.shift_created',
      )[0].handle;

      const effects = await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: {
          shiftId: 'shift-1',
          siteId: 'site-1',
          postId: 'post-1',
          employeeId: 'emp-1',
          startsAt: '2026-10-28T08:00:00Z',
          endsAt: '2026-10-28T16:00:00Z',
          status: 'SCHEDULED',
          version: 1,
        },
        tx: mockTx,
      });

      expect(mockShifts.upsertShift).toHaveBeenCalledWith(
        {
          id: 'shift-1',
          tenantId: 'tenant-1',
          siteId: 'site-1',
          postId: 'post-1',
          employeeId: 'emp-1',
          startsAt: '2026-10-28T08:00:00Z',
          endsAt: '2026-10-28T16:00:00Z',
          status: 'SCHEDULED',
          version: 1,
        },
        mockTx,
      );

      expect(effects).toHaveLength(1);
      await effects[0]();
      expect(mockTower.emitSiteSummaryUpdated).toHaveBeenCalledWith(
        'tenant-1',
        'site-1',
      );
    });

    it('throws PoisonEventError on missing required fields', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.organization.shift_created',
      )[0].handle;

      await expect(
        handler({
          tenantId: 'tenant-1',
          eventId: 'event-1',
          occurredAt: new Date(),
          payload: { shiftId: 'shift-1' }, // missing siteId, startsAt, etc.
          tx: mockTx,
        }),
      ).rejects.toThrow(PoisonEventError);
    });
  });

  describe('handleShiftStarted', () => {
    it('updates shift status to IN_PROGRESS', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.organization.shift_started',
      )[0].handle;

      await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: { shiftId: 'shift-1' },
        tx: mockTx,
      });

      expect(mockShifts.updateShiftStatus).toHaveBeenCalledWith(
        'tenant-1',
        'shift-1',
        'IN_PROGRESS',
        mockTx,
      );
    });
  });

  describe('handleShiftEnded', () => {
    it('updates status to COMPLETED and returns effects to recompute workday and summary', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.organization.shift_ended',
      )[0].handle;

      const effects = await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: { shiftId: 'shift-1', siteId: 'site-1' },
        tx: mockTx,
      });

      expect(mockShifts.updateShiftStatus).toHaveBeenCalledWith(
        'tenant-1',
        'shift-1',
        'COMPLETED',
        mockTx,
      );

      expect(effects).toHaveLength(1);
      await effects[0]();
      expect(mockWorkdays.recomputeWorkday).toHaveBeenCalledWith(
        'tenant-1',
        'shift-1',
      );
      expect(mockTower.emitSiteSummaryUpdated).toHaveBeenCalledWith(
        'tenant-1',
        'site-1',
      );
    });
  });

  describe('handleShiftStarting', () => {
    it('fetches shift snapshot to prime cache', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.organization.shift_starting',
      )[0].handle;

      await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: { shiftId: 'shift-1' },
        tx: mockTx,
      });

      expect(mockShifts.getShift).toHaveBeenCalledWith('tenant-1', 'shift-1');
    });
  });

  describe('handleSiteUpdated', () => {
    it('invalidates site cache', async () => {
      consumer.onModuleInit();
      const handler = mockProcessor.register.mock.calls.find(
        ([call]) => call.filter === 't.*.organization.site_updated',
      )[0].handle;

      await handler({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        occurredAt: new Date(),
        payload: { siteId: 'site-1' },
        tx: mockTx,
      });

      expect(mockSiteCache.invalidateSite).toHaveBeenCalledWith('site-1');
    });
  });
});
