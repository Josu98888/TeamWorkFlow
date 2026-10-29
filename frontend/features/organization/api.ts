import { USE_MOCKS } from '@/shared/lib/config';
import { organizationHttpApi } from './http';
import { organizationMockApi } from './mock';
import type { Employee, ListEmployeesQuery, ListShiftsQuery, ListSitesQuery, Paginated, Post, Shift, Site } from './types';

/** Read contract of the organization domain (writes arrive with their screens). */
export type OrganizationApi = {
  listSites: (query?: ListSitesQuery) => Promise<Paginated<Site>>;
  getSite: (siteId: string) => Promise<Site>;
  listPosts: (siteId: string) => Promise<Paginated<Post>>;
  listEmployees: (query?: ListEmployeesQuery) => Promise<Paginated<Employee>>;
  listShifts: (query?: ListShiftsQuery) => Promise<Paginated<Shift>>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const organizationApi: OrganizationApi = USE_MOCKS ? organizationMockApi : organizationHttpApi;
