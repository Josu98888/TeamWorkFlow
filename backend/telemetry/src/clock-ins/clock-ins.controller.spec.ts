import { Test, TestingModule } from '@nestjs/testing';
import { ClockInsController } from './clock-ins.controller';
import { ClockInsService } from './clock-ins.service';
import {
  ClockEventMethodDto,
  ClockEventTypeDto,
  CreateClockEventDto,
  CreateManualClockEventDto,
  CorrectClockEventDto,
  ListClockEventsDto,
} from './dto';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('ClockInsController', () => {
  let controller: ClockInsController;

  const mockClockInsService = {
    createClockEvent: jest.fn(),
    createManualClockEvent: jest.fn(),
    correctClockEvent: jest.fn(),
    listClockEvents: jest.fn(),
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
      controllers: [ClockInsController],
      providers: [
        {
          provide: ClockInsService,
          useValue: mockClockInsService,
        },
      ],
    }).compile();

    controller = module.get<ClockInsController>(ClockInsController);
  });

  describe('createClockEvent', () => {
    it('delegates to service.createClockEvent', async () => {
      const dto: CreateClockEventDto = {
        clientEventId: 'client-1',
        type: ClockEventTypeDto.IN,
        method: ClockEventMethodDto.GPS,
        siteId: 'site-1',
        deviceTime: new Date().toISOString(),
      };
      const expectedResult = { id: 'evt-1' };
      mockClockInsService.createClockEvent.mockResolvedValue(expectedResult);

      const result = await controller.createClockEvent(mockActor, dto);

      expect(mockClockInsService.createClockEvent).toHaveBeenCalledWith(
        mockActor,
        dto,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('createManualClockEvent', () => {
    it('delegates to service.createManualClockEvent', async () => {
      const dto: CreateManualClockEventDto = {
        employeeId: 'emp-1',
        shiftId: 'shift-1',
        type: ClockEventTypeDto.IN,
        time: new Date().toISOString(),
        reason: 'Manual entry',
      };
      const expectedResult = { id: 'evt-manual-1' };
      mockClockInsService.createManualClockEvent.mockResolvedValue(expectedResult);

      const result = await controller.createManualClockEvent(mockActor, dto);

      expect(mockClockInsService.createManualClockEvent).toHaveBeenCalledWith(
        mockActor,
        dto,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('correctClockEvent', () => {
    it('delegates to service.correctClockEvent', async () => {
      const dto: CorrectClockEventDto = {
        type: ClockEventTypeDto.OUT,
        reason: 'Correction reason',
      };
      const expectedResult = { id: 'evt-1', type: 'OUT' };
      mockClockInsService.correctClockEvent.mockResolvedValue(expectedResult);

      const result = await controller.correctClockEvent(
        mockActor,
        { clockEventId: 'evt-1' },
        dto,
      );

      expect(mockClockInsService.correctClockEvent).toHaveBeenCalledWith(
        mockActor,
        'evt-1',
        dto,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('listClockEvents', () => {
    it('delegates to service.listClockEvents', async () => {
      const query: ListClockEventsDto = { page: 1, pageSize: 20 };
      const expectedResult = { items: [], total: 0 };
      mockClockInsService.listClockEvents.mockResolvedValue(expectedResult);

      const result = await controller.listClockEvents(mockActor, query);

      expect(mockClockInsService.listClockEvents).toHaveBeenCalledWith(
        mockActor,
        query,
      );
      expect(result).toBe(expectedResult);
    });
  });
});
