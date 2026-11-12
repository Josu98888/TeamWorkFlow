import { Test, TestingModule } from '@nestjs/testing';
import { TowerController } from './tower.controller';
import { TowerService } from './tower.service';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

describe('TowerController', () => {
  let controller: TowerController;

  const mockTowerService = {
    getSnapshot: jest.fn(),
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
      controllers: [TowerController],
      providers: [
        {
          provide: TowerService,
          useValue: mockTowerService,
        },
      ],
    }).compile();

    controller = module.get<TowerController>(TowerController);
  });

  describe('getSnapshot', () => {
    it('delegates to towerService.getSnapshot', async () => {
      const expectedResult = { items: [] };
      mockTowerService.getSnapshot.mockResolvedValue(expectedResult);

      const result = await controller.getSnapshot(mockActor);

      expect(mockTowerService.getSnapshot).toHaveBeenCalledWith(mockActor);
      expect(result).toBe(expectedResult);
    });
  });
});
