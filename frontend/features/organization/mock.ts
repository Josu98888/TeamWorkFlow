import { minutesFromNow, mockResponse } from '@/shared/lib/mock';
import {
  CURRENT_ASSIGNMENTS,
  MOCK_TIMEZONE,
  POSTS_PER_SITE,
  SHIFT_SLOTS,
  SITE_COUNT,
  SITE_EMPLOYEES,
  TENANT_ID,
  employeeId,
  postId,
  shiftId,
  siteId,
  type ShiftSlot,
} from '@/shared/mocks/world';
import type { OrganizationApi } from './api';
import type { Employee, Paginated, Post, Shift, ShiftStatus, Site } from './types';

const CREATED_AT = '2026-03-02T12:00:00.000Z';

const SITE_SEEDS = [
  { name: 'Planta Norte Pilar', address: 'Ruta 8 km 60, Pilar, Buenos Aires', latitude: -34.4587, longitude: -58.9142, radius: 150 },
  { name: 'Centro Logístico Zárate', address: 'Av. Mitre 4200, Zárate, Buenos Aires', latitude: -34.0981, longitude: -59.0286, radius: 250 },
  { name: 'Hospital Central San Isidro', address: 'Av. Centenario 1520, San Isidro, Buenos Aires', latitude: -34.4708, longitude: -58.5286, radius: 120 },
  { name: 'Torre Corporativa Puerto Madero', address: 'Olga Cossettini 1050, CABA', latitude: -34.6118, longitude: -58.3634, radius: 80 },
  { name: 'Depósito Avellaneda', address: 'Av. Mitre 2300, Avellaneda, Buenos Aires', latitude: -34.6623, longitude: -58.3651, radius: 200 },
] as const;

const POST_NAMES: readonly (readonly string[])[] = [
  ['Acceso Principal', 'Ronda Perimetral', 'Monitoreo CCTV'],
  ['Control de Muelles', 'Acceso de Camiones', 'Guardia Nocturna'],
  ['Guardia de Urgencias', 'Recepción', 'Estacionamiento'],
  ['Recepción Ejecutiva', 'Control de Ascensores'],
  ['Portería', 'Ronda Interna'],
];

const POST_SKILLS: readonly (readonly string[])[] = [
  ['vigilador', 'CCTV'],
  ['vigilador', 'autoelevador'],
  ['vigilador', 'primeros auxilios'],
  ['atención al público'],
  ['vigilador'],
];

const EMPLOYEE_SEEDS = [
  ['Lucía', 'Fernández', ['vigilador', 'CCTV']],
  ['Martín', 'Gómez', ['vigilador']],
  ['Sofía', 'Rodríguez', ['vigilador', 'primeros auxilios']],
  ['Diego', 'Pérez', ['vigilador', 'autoelevador']],
  ['Valentina', 'López', ['vigilador', 'CCTV']],
  ['Nicolás', 'Martínez', ['vigilador']],
  ['Camila', 'Sosa', ['vigilador', 'autoelevador']],
  ['Joaquín', 'Romero', ['vigilador']],
  ['Agustina', 'Díaz', ['vigilador', 'primeros auxilios']],
  ['Facundo', 'Torres', ['vigilador']],
  ['Julieta', 'Acosta', ['atención al público']],
  ['Mateo', 'Benítez', ['atención al público', 'vigilador']],
] as const satisfies readonly (readonly [string, string, readonly string[]])[];

const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const SITES: Site[] = SITE_SEEDS.map((seed, index) => ({
  id: siteId(index),
  tenantId: TENANT_ID,
  name: seed.name,
  address: seed.address,
  latitude: seed.latitude,
  longitude: seed.longitude,
  geofenceRadiusMeters: seed.radius,
  timezone: MOCK_TIMEZONE,
  qrCode: `qr_${slug(seed.name).replace(/\W+/g, '_')}_8f3a1c`,
  qrRotatedAt: index === 0 ? '2026-08-14T15:20:00.000Z' : null,
  isActive: index < SITE_COUNT - 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}));

const POSTS: Post[] = POST_NAMES.flatMap((names, site) =>
  names.map((name, post) => ({
    id: postId(site, post),
    tenantId: TENANT_ID,
    siteId: siteId(site),
    name,
    requiredSkills: [...(POST_SKILLS[site] ?? [])],
    minPeople: 1,
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })),
);

const EMPLOYEES: Employee[] = EMPLOYEE_SEEDS.map(([firstName, lastName, skills], index) => ({
  id: employeeId(index),
  tenantId: TENANT_ID,
  userId: null,
  email: `${slug(firstName)}.${slug(lastName)}@empresa.com`,
  firstName,
  lastName,
  phone: `+54 11 5${String(100 + index * 7).padStart(3, '0')}-${String(2000 + index * 131).slice(0, 4)}`,
  avatarMediaId: null,
  employeeNumber: `L-${String(1001 + index)}`,
  nationalId: null,
  skills: [...skills],
  weeklyHoursLimit: 48,
  siteIds: SITE_EMPLOYEES.flatMap((employees, site) => (employees.includes(index) ? [siteId(site)] : [])),
  isActive: index !== 7,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}));

const SLOT_WINDOW = {
  previous: { start: -660, end: -180, status: 'FINISHED' },
  current: { start: -180, end: 300, status: 'IN_PROGRESS' },
  next: { start: 300, end: 780, status: 'SCHEDULED' },
} as const satisfies Record<ShiftSlot, { start: number; end: number; status: ShiftStatus }>;

/** Employee covering a post in a slot; the current one comes from the shared roster. */
function assignedEmployee(site: number, post: number, slot: ShiftSlot): string | null {
  if (slot === 'current') {
    const assignment = CURRENT_ASSIGNMENTS.find((item) => item.site === site && item.post === post);
    return assignment?.employee == null ? null : employeeId(assignment.employee);
  }
  const roster = SITE_EMPLOYEES[site] ?? [];
  const pick = roster[(post + (slot === 'next' ? 1 : 2)) % Math.max(roster.length, 1)];
  return pick === undefined ? null : employeeId(pick);
}

// The inactive site (last) has no shifts today.
const SHIFTS: Shift[] = Array.from({ length: SITE_COUNT - 1 }, (_, site) => site).flatMap((site) =>
  Array.from({ length: POSTS_PER_SITE[site] ?? 0 }, (_, post) => post).flatMap((post) =>
    SHIFT_SLOTS.map((slot) => {
      const window = SLOT_WINDOW[slot];
      return {
        id: shiftId(site, post, slot),
        tenantId: TENANT_ID,
        templateId: null,
        siteId: siteId(site),
        postId: postId(site, post),
        employeeId: assignedEmployee(site, post, slot),
        startsAt: minutesFromNow(window.start),
        endsAt: minutesFromNow(window.end),
        status: window.status,
        version: 1,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      };
    }),
  ),
);

function paginate<T>(items: T[]): Paginated<T> {
  return { items, total: items.length };
}

export const organizationMockApi: OrganizationApi = {
  listSites: () => mockResponse(paginate(SITES)),

  getSite: async (id) => {
    const site = SITES.find((item) => item.id === id);
    if (!site) throw new Error('La sede no existe.');
    return mockResponse(site);
  },

  listPosts: (id) => mockResponse(paginate(POSTS.filter((post) => post.siteId === id))),

  listEmployees: (query = {}) =>
    mockResponse(
      paginate(
        EMPLOYEES.filter(
          (employee) =>
            (!query.siteId || employee.siteIds.includes(query.siteId)) &&
            (query.isActive === undefined || employee.isActive === query.isActive),
        ),
      ),
    ),

  listShifts: (query = {}) =>
    mockResponse(
      paginate(
        SHIFTS.filter(
          (shift) =>
            (!query.siteId || shift.siteId === query.siteId) && (!query.employeeId || shift.employeeId === query.employeeId),
        ),
      ),
    ),
};
