import { ShiftLifecycleService } from './shift-lifecycle.service';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const SITE = '0199b7e0-0000-7000-8000-0000000000a1';
const POST = '0199b7e0-0000-7000-8000-0000000000c1';
const EMP = '0199b7e0-0000-7000-8000-0000000000e1';

type Status = 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

interface Row {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: Status;
  version: number;
  startingEmittedAt: Date | null;
}

type Where = Record<string, unknown>;

function isOperator(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !(value instanceof Date)
  );
}

function compare(field: unknown, op: string, expected: unknown) {
  const a = field instanceof Date ? field.getTime() : field;
  const b = expected instanceof Date ? expected.getTime() : expected;
  switch (op) {
    case 'lte':
      return (a as number) <= (b as number);
    case 'gt':
      return (a as number) > (b as number);
    case 'notIn':
      return !(expected as unknown[]).includes(field);
    default:
      throw new Error(`Unsupported operator ${op}`);
  }
}

function matches(row: Row, where: Where) {
  return Object.entries(where).every(([key, value]) => {
    const field = (row as unknown as Where)[key];
    if (isOperator(value)) {
      return Object.entries(value).every(([op, expected]) =>
        compare(field, op, expected),
      );
    }
    return field === value;
  });
}

const at = (iso: string) => new Date(iso);
const NOW = at('2026-03-10T12:00:00Z');

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    tenantId: TENANT_A,
    siteId: SITE,
    postId: POST,
    employeeId: EMP,
    startsAt: at('2026-03-10T20:00:00Z'),
    endsAt: at('2026-03-11T04:00:00Z'),
    status: 'SCHEDULED',
    version: 1,
    startingEmittedAt: null,
    ...overrides,
  };
}

function setup(store: Row[], suspended: string[] = []) {
  // Runs once before the next updateMany: simulates a write that wins the race.
  let beforeUpdate: (() => void) | undefined;
  const prisma = {
    tenantState: {
      findMany: jest.fn(() =>
        Promise.resolve(suspended.map((tenantId) => ({ tenantId }))),
      ),
    },
    shift: {
      findMany: jest.fn(({ where, take }: { where: Where; take: number }) =>
        Promise.resolve(
          store
            .filter((r) => matches(r, where))
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
            .slice(0, take)
            .map((r) => ({ ...r })),
        ),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
          beforeUpdate?.();
          beforeUpdate = undefined;
          const found = store.filter((r) => matches(r, where));
          for (const r of found) {
            const { version, ...rest } = data as {
              version?: { increment: number };
            };
            Object.assign(r, rest);
            if (version) r.version += version.increment;
          }
          return Promise.resolve({ count: found.length });
        },
      ),
    },
  };
  const events = {
    publish: jest.fn((_tenantId: string, _event: string, _payload: object) =>
      Promise.resolve(),
    ),
  };
  const service = new ShiftLifecycleService(prisma as never, events as never);
  return {
    service,
    events,
    prisma,
    store,
    interfere: (fn: () => void) => {
      beforeUpdate = fn;
    },
  };
}

const names = (events: { publish: jest.Mock }) =>
  events.publish.mock.calls.map((call: unknown[]) => call[1]);

describe('ShiftLifecycleService', () => {
  it('emits shift_starting once for a shift starting within 15 minutes', async () => {
    const { service, events, store } = setup([
      row('s1', { startsAt: at('2026-03-10T12:15:00Z') }),
    ]);

    await expect(service.tick(NOW)).resolves.toEqual({
      starting: 1,
      started: 0,
      ended: 0,
    });
    expect(events.publish).toHaveBeenCalledWith(
      TENANT_A,
      'shift_starting',
      expect.objectContaining({
        shiftId: 's1',
        tenantId: TENANT_A,
        siteId: SITE,
        postId: POST,
        employeeId: EMP,
        startsAt: '2026-03-10T12:15:00.000Z',
        endsAt: '2026-03-11T04:00:00.000Z',
        status: 'SCHEDULED',
        version: 1,
      }),
    );
    expect(store[0].startingEmittedAt).toEqual(NOW);
    expect(store[0].status).toBe('SCHEDULED');

    // The marker keeps a later tick from emitting it again.
    await service.tick(new Date(NOW.getTime() + 60_000));
    expect(names(events)).toEqual(['shift_starting']);
  });

  it('does not emit shift_starting before the lead time', async () => {
    const { service, events } = setup([
      row('s1', { startsAt: at('2026-03-10T12:15:01Z') }),
    ]);

    await service.tick(NOW);

    expect(events.publish).not.toHaveBeenCalled();
  });

  it('starts a shift exactly at its start time and bumps the version', async () => {
    const { service, events, store } = setup([
      row('s1', {
        startsAt: NOW,
        startingEmittedAt: at('2026-03-10T11:50:00Z'),
      }),
    ]);

    await expect(service.tick(NOW)).resolves.toMatchObject({ started: 1 });

    expect(store[0]).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
    expect(events.publish).toHaveBeenCalledWith(
      TENANT_A,
      'shift_started',
      expect.objectContaining({
        shiftId: 's1',
        status: 'IN_PROGRESS',
        version: 2,
      }),
    );
  });

  it('finishes an in-progress shift exactly at its end time', async () => {
    const { service, events, store } = setup([
      row('s1', {
        status: 'IN_PROGRESS',
        version: 2,
        startsAt: at('2026-03-10T04:00:00Z'),
        endsAt: NOW,
      }),
    ]);

    await expect(service.tick(NOW)).resolves.toMatchObject({ ended: 1 });

    expect(store[0]).toMatchObject({ status: 'FINISHED', version: 3 });
    expect(events.publish).toHaveBeenCalledWith(
      TENANT_A,
      'shift_ended',
      expect.objectContaining({ status: 'FINISHED', version: 3 }),
    );
  });

  it('leaves a shift untouched one millisecond before its boundaries', async () => {
    const { service, events } = setup([
      row('s1', { startsAt: new Date(NOW.getTime() + 1) }),
      row('s2', {
        status: 'IN_PROGRESS',
        startsAt: at('2026-03-10T04:00:00Z'),
        endsAt: new Date(NOW.getTime() + 1),
      }),
    ]);

    await service.tick(NOW);

    // s1 is inside the lead time (starting); neither is started or ended.
    expect(names(events)).toEqual(['shift_starting']);
  });

  it('catches up a shift that was missed entirely: started, then ended', async () => {
    const { service, events, store } = setup([
      row('s1', {
        startsAt: at('2026-03-10T02:00:00Z'),
        endsAt: at('2026-03-10T10:00:00Z'),
      }),
    ]);

    await expect(service.tick(NOW)).resolves.toEqual({
      starting: 0,
      started: 1,
      ended: 1,
    });

    expect(names(events)).toEqual(['shift_started', 'shift_ended']);
    expect(store[0]).toMatchObject({ status: 'FINISHED', version: 3 });
  });

  it('emits nothing when the tick runs twice for the same instant', async () => {
    const { service, events } = setup([
      row('s1', { startsAt: at('2026-03-10T11:00:00Z') }),
    ]);

    await service.tick(NOW);
    const result = await service.tick(NOW);

    expect(result).toEqual({ starting: 0, started: 0, ended: 0 });
    expect(names(events)).toEqual(['shift_started']);
  });

  it('skips cancelled and finished shifts', async () => {
    const { service, events } = setup([
      row('s1', { status: 'CANCELLED', startsAt: at('2026-03-10T11:00:00Z') }),
      row('s2', {
        status: 'FINISHED',
        startsAt: at('2026-03-10T01:00:00Z'),
        endsAt: at('2026-03-10T09:00:00Z'),
      }),
    ]);

    await service.tick(NOW);

    expect(events.publish).not.toHaveBeenCalled();
  });

  it('processes several tenants in one tick and emits under each tenant', async () => {
    const { service, events } = setup([
      row('a1', { startsAt: at('2026-03-10T11:00:00Z') }),
      row('b1', { tenantId: TENANT_B, startsAt: at('2026-03-10T11:30:00Z') }),
    ]);

    await expect(service.tick(NOW)).resolves.toMatchObject({ started: 2 });

    const tenants = events.publish.mock.calls.map((c: unknown[]) => c[0]);
    expect(tenants).toEqual([TENANT_A, TENANT_B]);
  });

  it('skips suspended tenants and catches them up after reactivation', async () => {
    const store = [
      row('a1', { startsAt: at('2026-03-10T11:00:00Z') }),
      row('b1', { tenantId: TENANT_B, startsAt: at('2026-03-10T11:00:00Z') }),
    ];
    const suspendedRun = setup(store, [TENANT_A]);

    await suspendedRun.service.tick(NOW);

    expect(suspendedRun.events.publish).toHaveBeenCalledTimes(1);
    expect(suspendedRun.events.publish.mock.calls[0][0]).toBe(TENANT_B);
    expect(store[0].status).toBe('SCHEDULED');

    // Reactivated: no suspended tenant left, the next tick catches up.
    const resumed = setup(store, []);
    await resumed.service.tick(NOW);
    expect(resumed.events.publish).toHaveBeenCalledTimes(1);
    expect(resumed.events.publish.mock.calls[0][0]).toBe(TENANT_A);
  });

  it('emits nothing when a concurrent edit wins the compare-and-set', async () => {
    const { service, events, store, interfere } = setup([
      row('s1', { startsAt: at('2026-03-10T11:00:00Z') }),
    ]);
    // A user edit bumps the version between the read and the update.
    interfere(() => {
      store[0].version = 2;
    });

    await expect(service.tick(NOW)).resolves.toMatchObject({ started: 0 });

    expect(events.publish).not.toHaveBeenCalled();
    expect(store[0].status).toBe('SCHEDULED');

    // The next tick reads the new version and applies the transition once.
    await service.tick(NOW);
    expect(names(events)).toEqual(['shift_started']);
    expect(store[0]).toMatchObject({ status: 'IN_PROGRESS', version: 3 });
  });

  it('emits nothing when another instance already moved the shift', async () => {
    const { service, events, store, interfere } = setup([
      row('s1', { startsAt: at('2026-03-10T11:00:00Z') }),
    ]);
    interfere(() => {
      store[0].status = 'IN_PROGRESS';
      store[0].version = 2;
    });

    await expect(service.tick(NOW)).resolves.toMatchObject({ started: 0 });

    expect(events.publish).not.toHaveBeenCalled();
  });

  it('logs only the error name when a scheduled tick fails', async () => {
    const { service, prisma } = setup([]);
    prisma.tenantState.findMany.mockRejectedValueOnce(
      new Error('boom ana@example.com'),
    );
    const error = jest.fn();
    (service as unknown as { logger: { error: jest.Mock } }).logger = {
      error,
    };

    await service.handleTick();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain('example.com');
  });
});
