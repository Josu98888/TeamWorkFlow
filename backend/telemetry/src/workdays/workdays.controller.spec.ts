import { Test, TestingModule } from '@nestjs/testing';
import { WorkdaysController } from './workdays.controller';
import { WorkdaysService } from './workdays.service';
import { ListWorkdaysDto, WorkdayStatusDto } from './dto';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('WorkdaysController', () => {
  let controller: WorkdaysController;

  const mockWorkdaysService = {
    getWorkdayByShiftId: jest.fn(),
    listWorkdays: jest.fn(),
  };

  const mockActor: VerifiedActor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: 'employee',
    siteIds: ['site-1'],
    tenantStatus: 'active',
    plan: 'pro',
    features: { alerts: true, tower: true },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkdaysController],
      providers: [
        {
          provide: WorkdaysService,
          useValue: mockWorkdaysService,
        },
      ],
    }).compile();

    controller = module.get<WorkdaysController>(WorkdaysController);
  });

  describe('getWorkday', () => {
    it('delegates to service.getWorkdayByShiftId', async () => {
      const expectedResult = { id: 'wd-1' };
      mockWorkdaysService.getWorkdayByShiftId.mockResolvedValue(expectedResult);

      const result = await controller.getWorkday(mockActor, {
        shiftId: 'shift-1',
      });

      expect(mockWorkdaysService.getWorkdayByShiftId).toHaveBeenCalledWith(
        mockActor,
        'shift-1',
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('listWorkdays', () => {
    it('delegates to service.listWorkdays', async () => {
      const query: ListWorkdaysDto = {
        status: WorkdayStatusDto.CLOSED,
        page: 1,
        pageSize: 10,
      };
      const expectedResult = { items: [], total: 0 };
      mockWorkdaysService.listWorkdays.mockResolvedValue(expectedResult);

      const result = await controller.listWorkdays(mockActor, query);

      expect(mockWorkdaysService.listWorkdays).toHaveBeenCalledWith(
        mockActor,
        query,
      );
      expect(result).toBe(expectedResult);
    });
  });
});
