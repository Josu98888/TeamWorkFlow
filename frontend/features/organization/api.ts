import { USE_MOCKS } from '@/shared/lib/config';
import { organizationHttpApi } from './http';
import { organizationMockApi } from './mock';
import type {
  CreateEmployeeInput,
  CreatePostInput,
  CreateShiftInput,
  CreateSiteInput,
  Employee,
  ListEmployeesQuery,
  ListShiftsQuery,
  ListSitesQuery,
  Paginated,
  Post,
  Shift,
  ShiftWithWarnings,
  Site,
  UpdateEmployeeInput,
  UpdatePostInput,
  UpdateShiftInput,
  UpdateSiteInput,
} from './types';

/** Contract of the organization domain (reads and writes). Writes are not available in mock mode. */
export type OrganizationApi = {
  listSites: (query?: ListSitesQuery) => Promise<Paginated<Site>>;
  getSite: (siteId: string) => Promise<Site>;
  listPosts: (siteId: string) => Promise<Paginated<Post>>;
  listEmployees: (query?: ListEmployeesQuery) => Promise<Paginated<Employee>>;
  listShifts: (query?: ListShiftsQuery) => Promise<Paginated<Shift>>;
  createSite: (input: CreateSiteInput) => Promise<Site>;
  updateSite: (siteId: string, input: UpdateSiteInput) => Promise<Site>;
  /** Returns the site with the new `qrCode`. */
  rotateSiteQr: (siteId: string) => Promise<Site>;
  createPost: (siteId: string, input: CreatePostInput) => Promise<Post>;
  updatePost: (postId: string, input: UpdatePostInput) => Promise<Post>;
  createEmployee: (input: CreateEmployeeInput) => Promise<Employee>;
  updateEmployee: (employeeId: string, input: UpdateEmployeeInput) => Promise<Employee>;
  createShift: (input: CreateShiftInput) => Promise<ShiftWithWarnings>;
  updateShift: (shiftId: string, input: UpdateShiftInput) => Promise<ShiftWithWarnings>;
  reassignShift: (shiftId: string, input: { version: number; employeeId: string | null }) => Promise<ShiftWithWarnings>;
  cancelShift: (shiftId: string, input: { version: number }) => Promise<Shift>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const organizationApi: OrganizationApi = USE_MOCKS ? organizationMockApi : organizationHttpApi;
