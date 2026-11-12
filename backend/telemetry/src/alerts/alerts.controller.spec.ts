import { Test, TestingModule } from '@nestjs/testing';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertStatusDto, AlertTypeDto, ListAlertsDto } from './dto';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('AlertsController', () => {
  let controller: AlertsController;

  const mockAlertsService = {
    listAlerts: jest.fn(),
    acknowledgeAlert: jest.fn(),
    resolveAlert: jest.fn(),
  };

  const mockActor: VerifiedActor = {
    userId: 'user-sup',
    tenantId: 'tenant-1',
    role: 'supervisor',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        {
          provide: AlertsService,
          useValue: mockAlertsService,
        },
      ],
    }).compile();

    controller = module.get<AlertsController>(AlertsController);
  });

  describe('listAlerts', () => {
    it('delegates to service.listAlerts', async () => {
      const query: ListAlertsDto = {
        status: AlertStatusDto.OPEN,
        type: AlertTypeDto.LATE,
        page: 1,
        pageSize: 10,
      };
      const expectedResult = { items: [], total: 0 };
      mockAlertsService.listAlerts.mockResolvedValue(expectedResult);

      const result = await controller.listAlerts(mockActor, query);

      expect(mockAlertsService.listAlerts).toHaveBeenCalledWith(
        mockActor,
        query,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('acknowledgeAlert', () => {
    it('delegates to service.acknowledgeAlert', async () => {
      const expectedResult = { id: 'alert-1', status: 'ACKNOWLEDGED' };
      mockAlertsService.acknowledgeAlert.mockResolvedValue(expectedResult);

      const result = await controller.acknowledgeAlert(mockActor, {
        alertId: 'alert-1',
      });

      expect(mockAlertsService.acknowledgeAlert).toHaveBeenCalledWith(
        mockActor,
        'alert-1',
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('resolveAlert', () => {
    it('delegates to service.resolveAlert', async () => {
      const expectedResult = { id: 'alert-1', status: 'RESOLVED' };
      mockAlertsService.resolveAlert.mockResolvedValue(expectedResult);

      const result = await controller.resolveAlert(
        mockActor,
        { alertId: 'alert-1' },
        { reason: 'Issue handled' },
      );

      expect(mockAlertsService.resolveAlert).toHaveBeenCalledWith(
        mockActor,
        'alert-1',
        { reason: 'Issue handled' },
      );
      expect(result).toBe(expectedResult);
    });
  });
});
