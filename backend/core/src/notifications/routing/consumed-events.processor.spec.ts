jest.mock('../../config', () => ({
  envs: {
    notificationsDatabaseUrl:
      'postgresql://notifications_svc:secret@localhost:5432/teamworkflow?schema=notifications',
  },
}));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
}));
jest.mock('../../auth/prisma/generated/client', () => ({
  PrismaClient: class {},
}));
jest.mock('../../organization/prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import { EmployeeNotFoundException } from '../../common/exceptions/app.exceptions';
import type { AuthService } from '../../auth/auth.service';
import type { OrganizationService } from '../../organization/organization.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { NotificationsEventsService } from '../events/notifications-events.service';
import type { NotificationsPrismaService } from '../prisma/prisma.service';
import { ConsumedEventsProcessor } from './consumed-events.processor';

describe('ConsumedEventsProcessor', () => {
  let processor: ConsumedEventsProcessor;
  let mockPrisma: {
    processedEvent: {
      findUnique: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    tenantState: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
    tenantFeatures: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
    notificationDelivery: { deleteMany: jest.Mock };
    notification: { deleteMany: jest.Mock };
    deviceToken: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockEvents: { registerHandler: jest.Mock };
  let mockDelivery: {
    stageDeliveries: jest.Mock;
    dispatchPushes: jest.Mock;
  };
  let mockAuth: { listRecipients: jest.Mock };
  let mockOrg: { getEmployeeForTenant: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      processedEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenantState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenantFeatures: {
        findUnique: jest.fn().mockResolvedValue({ features: { alerts: true } }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notificationDelivery: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      deviceToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(mockPrisma),
      ),
    };
    mockEvents = { registerHandler: jest.fn() };
    mockDelivery = {
      stageDeliveries: jest.fn().mockResolvedValue([{ deliveryId: 'deliv-1' }]),
      dispatchPushes: jest.fn().mockResolvedValue(undefined),
    };
    mockAuth = { listRecipients: jest.fn() };
    mockOrg = { getEmployeeForTenant: jest.fn() };

    processor = new ConsumedEventsProcessor(
      mockPrisma as unknown as NotificationsPrismaService,
      mockEvents as unknown as NotificationsEventsService,
      mockDelivery as unknown as DeliveryService,
      mockAuth as unknown as AuthService,
      mockOrg as unknown as OrganizationService,
    );
  });

  it('registers all 9 JetStream handlers on module init', () => {
    processor.onModuleInit();
    expect(mockEvents.registerHandler).toHaveBeenCalledTimes(9);
  });

  it('delivers billing_* templates while suspended and resolves empty recipientUserIds to owners/admins', async () => {
    mockPrisma.tenantState.findUnique.mockResolvedValueOnce({
      isSuspended: true,
    });
    mockAuth.listRecipients.mockResolvedValueOnce({
      userIds: ['owner-1', 'admin-1'],
    });

    await processor.handleNotificationSend({
      subject: 't.tenant-1.notifications.send',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-bill-1',
        tenantId: 'tenant-1',
        recipientUserIds: [],
        templateCode: 'billing_invoice_issued',
        data: { period: '2026-11', total: '100.00', dueDate: '2026-11-25' },
      },
    });

    expect(mockAuth.listRecipients).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      roles: ['owner', 'admin'],
    });
    expect(mockDelivery.stageDeliveries).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        tenantId: 'tenant-1',
        recipientUserIds: ['owner-1', 'admin-1'],
        templateCode: 'billing_invoice_issued',
        sourceEventId: 'evt-bill-1',
      }),
    );
    expect(mockDelivery.dispatchPushes).toHaveBeenCalledTimes(1);
  });

  it('drops non-billing notifications.send while tenant is suspended and ignores duplicate eventIds', async () => {
    mockPrisma.tenantState.findUnique.mockResolvedValueOnce({
      isSuspended: true,
    });

    await processor.handleNotificationSend({
      subject: 't.tenant-1.notifications.send',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-nonbill',
        tenantId: 'tenant-1',
        recipientUserIds: ['user-1'],
        templateCode: 'task_assigned',
      },
    });

    expect(mockDelivery.stageDeliveries).not.toHaveBeenCalled();

    mockPrisma.processedEvent.findUnique.mockResolvedValueOnce({
      eventId: 'evt-dup',
    });
    await processor.handleNotificationSend({
      subject: 't.tenant-1.notifications.send',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-dup',
        tenantId: 'tenant-1',
        recipientUserIds: ['user-1'],
        templateCode: 'billing_suspended',
      },
    });
    expect(mockDelivery.stageDeliveries).not.toHaveBeenCalled();
  });

  it('routes attendance.alert_opened only when alerts feature is enabled', async () => {
    mockPrisma.tenantFeatures.findUnique.mockResolvedValueOnce({
      features: { alerts: false },
    });

    await processor.handleAlertOpened({
      subject: 't.tenant-1.attendance.alert_opened',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-alert-no-feature',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        type: 'ABSENCE',
      },
    });
    expect(mockAuth.listRecipients).not.toHaveBeenCalled();

    mockPrisma.tenantFeatures.findUnique.mockResolvedValueOnce({
      features: { alerts: true },
    });
    mockAuth.listRecipients.mockResolvedValueOnce({
      userIds: ['owner-1', 'sup-1'],
    });

    await processor.handleAlertOpened({
      subject: 't.tenant-1.attendance.alert_opened',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-alert-1',
        tenantId: 'tenant-1',
        alertId: 'alert-1',
        siteId: 'site-1',
        siteName: 'Sede Centro',
        type: 'LATE',
      },
    });

    expect(mockAuth.listRecipients).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      roles: ['owner', 'admin', 'supervisor'],
      siteId: 'site-1',
    });
    expect(mockDelivery.stageDeliveries).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        templateCode: 'alert_opened',
        recipientUserIds: ['owner-1', 'sup-1'],
      }),
    );
  });

  it('routes tasks.task_assigned via OrganizationService and bubbles transient errors', async () => {
    mockOrg.getEmployeeForTenant.mockResolvedValueOnce({
      id: 'emp-1',
      userId: 'user-emp-1',
      isActive: true,
    });

    await processor.handleTaskAssigned({
      subject: 't.tenant-1.tasks.task_assigned',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-task-1',
        tenantId: 'tenant-1',
        taskId: 'task-1',
        employeeId: 'emp-1',
        siteId: 'site-1',
        title: 'Control',
        deadline: '2026-11-15T18:00:00Z',
      },
    });

    expect(mockOrg.getEmployeeForTenant).toHaveBeenCalledWith('tenant-1', {
      employeeId: 'emp-1',
    });
    expect(mockDelivery.stageDeliveries).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        templateCode: 'task_assigned',
        recipientUserIds: ['user-emp-1'],
      }),
    );

    mockOrg.getEmployeeForTenant.mockRejectedValueOnce(
      new EmployeeNotFoundException(),
    );
    await expect(
      processor.handleTaskAssigned({
        subject: 't.tenant-1.tasks.task_assigned',
        tenantId: 'tenant-1',
        payload: {
          eventId: 'evt-task-missing',
          tenantId: 'tenant-1',
          employeeId: 'emp-404',
        },
      }),
    ).resolves.toBeUndefined();

    mockOrg.getEmployeeForTenant.mockRejectedValueOnce(
      new Error('organization db timeout'),
    );
    await expect(
      processor.handleTaskAssigned({
        subject: 't.tenant-1.tasks.task_assigned',
        tenantId: 'tenant-1',
        payload: {
          eventId: 'evt-task-err',
          tenantId: 'tenant-1',
          employeeId: 'emp-1',
        },
      }),
    ).rejects.toThrow('organization db timeout');
  });

  it('rejects tenantId mismatches across payload and subject', async () => {
    await processor.handleNotificationSend({
      subject: 't.tenant-1.notifications.send',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-mismatch',
        tenantId: 'tenant-2',
        templateCode: 'billing_suspended',
      },
    });
    expect(mockDelivery.stageDeliveries).not.toHaveBeenCalled();
  });

  it('syncs TenantState, respects effectiveAt for TenantFeatures, and purges all tenant data on data_retention_expired', async () => {
    await processor.handleTenantState(
      {
        subject: 't.tenant-1.auth.tenant_suspended',
        tenantId: 'tenant-1',
        payload: { eventId: 'evt-susp', tenantId: 'tenant-1' },
      },
      true,
    );
    expect(mockPrisma.tenantState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
        create: expect.objectContaining({ isSuspended: true }),
      }),
    );

    mockPrisma.tenantFeatures.findFirst.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      effectiveAt: new Date('2026-11-12T12:00:00.000Z'),
    });
    await processor.handlePlanFeatures({
      subject: 't.tenant-1.billing.plan_changed',
      tenantId: 'tenant-1',
      payload: {
        eventId: 'evt-stale-plan',
        tenantId: 'tenant-1',
        effectiveAt: '2026-11-10T12:00:00.000Z',
        features: { alerts: false },
      },
    });
    expect(mockPrisma.tenantFeatures.upsert).not.toHaveBeenCalled();

    await processor.handleDataRetentionExpired({
      subject: 't.tenant-1.billing.data_retention_expired',
      tenantId: 'tenant-1',
      payload: { eventId: 'evt-purge', tenantId: 'tenant-1' },
    });
    expect(mockPrisma.notificationDelivery.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(mockPrisma.tenantState.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(mockPrisma.tenantFeatures.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(mockPrisma.processedEvent.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });
});
