import { Logger } from '@nestjs/common';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import {
  CONSUMED_SUBJECTS,
  subjectMatches,
  tenantIdFromSubject,
  type ConsumedMessage,
} from '../events/consumed-events';
import { splitName, UserCreatedHandler } from './user-created.handler';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER = '0199b7e0-0000-7000-8000-000000000001';
const OTHER_USER = '0199b7e0-0000-7000-8000-000000000002';
const EVENT_ID = '0199b7e0-0000-7000-8000-0000000000e1';
const OCCURRED_AT = '2026-10-13T10:00:00.000Z';

interface EmployeeRow {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
}

describe('UserCreatedHandler (auth.user_created consumer)', () => {
  let employees: EmployeeRow[];
  let processed: Set<string>;
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  let errorLog: jest.SpyInstance;

  const tx = {
    processedEvent: { createMany: jest.fn() },
    employee: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn(), ...tx };

  function deliver(
    fields: Record<string, unknown>,
    subjectTenant: string | null = TENANT_A,
    eventId = EVENT_ID,
  ) {
    const subject = `t.${TENANT_A}.auth.user_created`;
    const handler = handlers.find((h) => subjectMatches(h.filter, subject))!;
    return handler.run({
      subject,
      tenantId: subjectTenant,
      payload: {
        eventId,
        occurredAt: OCCURRED_AT,
        tenantId: TENANT_A,
        userId: USER,
        email: 'Ana@Example.com',
        name: 'Ana Maria Alvarez',
        role: 'employee',
        ...fields,
      },
    });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    employees = [];
    processed = new Set();
    handlers = [];

    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        // A thrown handler rolls everything back, including the dedupe row.
        const snapshot = {
          employees: employees.map((e) => ({ ...e })),
          processed: new Set(processed),
        };
        try {
          return await callback(tx);
        } catch (error) {
          employees = snapshot.employees;
          processed = snapshot.processed;
          throw error;
        }
      },
    );
    tx.processedEvent.createMany.mockImplementation(
      ({ data }: { data: { eventId: string }[] }) => {
        const fresh = !processed.has(data[0].eventId);
        processed.add(data[0].eventId);
        return Promise.resolve({ count: fresh ? 1 : 0 });
      },
    );
    tx.employee.findFirst.mockImplementation(
      ({
        where,
      }: {
        where: { tenantId: string; userId?: string; email?: string };
      }) =>
        Promise.resolve(
          employees.find(
            (e) =>
              e.tenantId === where.tenantId &&
              (where.userId === undefined || e.userId === where.userId) &&
              (where.email === undefined || e.email === where.email),
          ) ?? null,
        ),
    );
    tx.employee.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string; tenantId: string; userId: null };
        data: { userId: string };
      }) => {
        const hits = employees.filter(
          (e) =>
            e.id === where.id &&
            e.tenantId === where.tenantId &&
            e.userId === null,
        );
        hits.forEach((e) => Object.assign(e, data));
        return Promise.resolve({ count: hits.length });
      },
    );
    tx.employee.create.mockImplementation(
      ({ data }: { data: Omit<EmployeeRow, 'id'> }) => {
        employees.push({ id: `e-${employees.length + 1}`, ...data });
        return Promise.resolve();
      },
    );

    const events = {
      registerHandler: (
        filter: string,
        run: (m: ConsumedMessage) => Promise<void>,
      ) => handlers.push({ filter, run }),
    };
    const processor = new ConsumedEventProcessor(
      prisma as never,
      events as never,
    );
    new UserCreatedHandler(processor).onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers for t.*.auth.user_created', () => {
    expect(handlers.map((h) => h.filter)).toEqual([
      CONSUMED_SUBJECTS.userCreated,
    ]);
  });

  it('links the user to the employee of the tenant with the same email', async () => {
    employees.push({
      id: 'e-1',
      tenantId: TENANT_A,
      userId: null,
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'A',
    });

    await deliver({});

    expect(employees).toHaveLength(1);
    expect(employees[0].userId).toBe(USER);
    expect(tx.employee.create).not.toHaveBeenCalled();
  });

  it('never links to an employee of another tenant: it creates a profile instead', async () => {
    employees.push({
      id: 'e-x',
      tenantId: TENANT_B,
      userId: null,
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'A',
    });

    await deliver({});

    expect(employees.find((e) => e.id === 'e-x')!.userId).toBeNull();
    expect(employees).toHaveLength(2);
    expect(employees[1]).toEqual(
      expect.objectContaining({ tenantId: TENANT_A, userId: USER }),
    );
  });

  it('creates a profile without legajo when no employee has that email', async () => {
    await deliver({});

    expect(employees).toEqual([
      {
        id: 'e-1',
        tenantId: TENANT_A,
        userId: USER,
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: 'Maria Alvarez',
      },
    ]);
    expect(tx.employee.create.mock.calls[0][0].data).not.toHaveProperty(
      'employeeNumber',
    );
  });

  it('does not overwrite an employee already linked to another user', async () => {
    employees.push({
      id: 'e-1',
      tenantId: TENANT_A,
      userId: OTHER_USER,
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'A',
    });

    await deliver({});

    expect(employees).toHaveLength(1);
    expect(employees[0].userId).toBe(OTHER_USER);
  });

  it('is idempotent on a duplicate eventId: the second delivery writes nothing', async () => {
    await deliver({});
    await deliver({});

    expect(employees).toHaveLength(1);
    expect(tx.employee.create).toHaveBeenCalledTimes(1);
    expect(tx.employee.findFirst).toHaveBeenCalledTimes(2);
  });

  it('is idempotent on the same user under a different eventId (natural key)', async () => {
    await deliver({});
    await deliver({}, TENANT_A, '0199b7e0-0000-7000-8000-0000000000e2');

    expect(employees).toHaveLength(1);
  });

  it('rejects a tenant mismatch between subject and payload without touching the database', async () => {
    await expect(deliver({ tenantId: TENANT_B })).resolves.toBeUndefined();
    await expect(deliver({}, TENANT_B)).resolves.toBeUndefined();
    await expect(deliver({}, null)).resolves.toBeUndefined();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(employees).toHaveLength(0);
    expect(errorLog).toHaveBeenCalledTimes(3);
  });

  it('logs a rejected event without payload data', async () => {
    await deliver({ tenantId: TENANT_B });

    const logged = String(errorLog.mock.calls[0][0]);
    for (const secret of [TENANT_B, EVENT_ID, 'example.com', 'Ana']) {
      expect(logged).not.toContain(secret);
    }
  });

  it.each([
    ['a missing userId', { userId: undefined }],
    ['a userId that is not a uuid', { userId: 'user-1' }],
    ['a missing email', { email: undefined }],
    ['an empty email', { email: '   ' }],
    ['a missing name', { name: undefined }],
  ])(
    'discards %s as poison: acked, rolled back, nothing stored',
    async (_l, fields) => {
      await expect(deliver(fields)).resolves.toBeUndefined();

      expect(employees).toHaveLength(0);
      // Rolled back with the transaction: a corrected redelivery is not deduped.
      expect(processed.size).toBe(0);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(String(errorLog.mock.calls[0][0])).not.toContain('example.com');
    },
  );

  it('rethrows an unexpected database failure so the message is redelivered', async () => {
    tx.employee.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(deliver({})).rejects.toThrow('db down');
    expect(processed.size).toBe(0);
  });

  describe('helpers', () => {
    it('splits the single auth name into first and last name', () => {
      expect(splitName('Ana', 'a@x.com')).toEqual({
        firstName: 'Ana',
        lastName: '',
      });
      expect(splitName('  Ana  Maria   Alvarez ', 'a@x.com')).toEqual({
        firstName: 'Ana',
        lastName: 'Maria Alvarez',
      });
      expect(splitName('   ', 'ana@x.com')).toEqual({
        firstName: 'ana',
        lastName: '',
      });
    });

    it('reads the tenant from the subject and matches wildcard filters', () => {
      expect(tenantIdFromSubject(`t.${TENANT_A}.auth.user_created`)).toBe(
        TENANT_A,
      );
      expect(tenantIdFromSubject('x.y.z')).toBeNull();
      expect(
        subjectMatches(
          CONSUMED_SUBJECTS.userCreated,
          `t.${TENANT_A}.auth.user_created`,
        ),
      ).toBe(true);
      expect(
        subjectMatches(
          CONSUMED_SUBJECTS.userCreated,
          `t.${TENANT_A}.auth.user_deactivated`,
        ),
      ).toBe(false);
    });
  });
});
