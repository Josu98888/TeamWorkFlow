import { Test, TestingModule } from '@nestjs/testing';
import { AuthConsumer } from './auth.handler';
import { ConsumedEventProcessor } from '../consumed-event.processor';
import { TenantStateService } from '../../tenants/tenant-state.service';

describe('AuthConsumer', () => {
  let consumer: AuthConsumer;

  const mockProcessor = {
    register: jest.fn(),
  };

  const mockTenantState = {
    setSuspended: jest.fn(),
  };

  const mockTx = {} as any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthConsumer,
        { provide: ConsumedEventProcessor, useValue: mockProcessor },
        { provide: TenantStateService, useValue: mockTenantState },
      ],
    }).compile();

    consumer = module.get<AuthConsumer>(AuthConsumer);
  });

  it('registers all auth filters on init', () => {
    consumer.onModuleInit();
    expect(mockProcessor.register).toHaveBeenCalledTimes(3);
  });

  it('handles tenant_suspended by setting isSuspended = true', async () => {
    consumer.onModuleInit();
    const handler = mockProcessor.register.mock.calls.find(
      ([call]) => call.filter === 't.*.auth.tenant_suspended',
    )[0].handle;

    await handler({
      tenantId: 'tenant-1',
      eventId: 'event-1',
      occurredAt: new Date(),
      payload: {},
      tx: mockTx,
    });

    expect(mockTenantState.setSuspended).toHaveBeenCalledWith(
      'tenant-1',
      true,
      mockTx,
    );
  });

  it('handles tenant_cancelled by setting isSuspended = true', async () => {
    consumer.onModuleInit();
    const handler = mockProcessor.register.mock.calls.find(
      ([call]) => call.filter === 't.*.auth.tenant_cancelled',
    )[0].handle;

    await handler({
      tenantId: 'tenant-1',
      eventId: 'event-1',
      occurredAt: new Date(),
      payload: {},
      tx: mockTx,
    });

    expect(mockTenantState.setSuspended).toHaveBeenCalledWith(
      'tenant-1',
      true,
      mockTx,
    );
  });

  it('handles tenant_reactivated by setting isSuspended = false', async () => {
    consumer.onModuleInit();
    const handler = mockProcessor.register.mock.calls.find(
      ([call]) => call.filter === 't.*.auth.tenant_reactivated',
    )[0].handle;

    await handler({
      tenantId: 'tenant-1',
      eventId: 'event-1',
      occurredAt: new Date(),
      payload: {},
      tx: mockTx,
    });

    expect(mockTenantState.setSuspended).toHaveBeenCalledWith(
      'tenant-1',
      false,
      mockTx,
    );
  });
});
