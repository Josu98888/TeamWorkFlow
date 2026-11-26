import { USE_MOCKS } from '@/shared/lib/config';
import { organizationHttpApi } from './http';
import { organizationMockApi } from './mock';
import type {
  AssignShiftOvertimeInput,
  BulkImportEmployeesInput,
  BulkImportEmployeesResponse,
  CreateEmployeeInput,
  CreatePostInput,
  CreateShiftInput,
  CreateShiftTemplateInput,
  CreateSiteInput,
  Employee,
  ListEmployeesQuery,
  ListShiftTemplatesQuery,
  ListShiftsQuery,
  ListSitesQuery,
  Paginated,
  Post,
  Shift,
  ShiftTemplate,
  ShiftTemplateWithGeneration,
  ShiftWithWarnings,
  Site,
  UpdateEmployeeInput,
  UpdatePostInput,
  UpdateShiftInput,
  UpdateShiftTemplateInput,
  UpdateSiteInput,
} from './types';

/** Contract of the organization domain (reads and writes). Writes are not available in mock mode. */
export type OrganizationApi = {
  listSites: (query?: ListSitesQuery) => Promise<Paginated<Site>>;
  getSite: (siteId: string) => Promise<Site>;
  listPosts: (siteId: string, query?: ListSitesQuery) => Promise<Paginated<Post>>;
  listEmployees: (query?: ListEmployeesQuery) => Promise<Paginated<Employee>>;
  listShifts: (query?: ListShiftsQuery) => Promise<Paginated<Shift>>;
  listShiftTemplates: (query?: ListShiftTemplatesQuery) => Promise<Paginated<ShiftTemplate>>;
  createSite: (input: CreateSiteInput) => Promise<Site>;
  updateSite: (siteId: string, input: UpdateSiteInput) => Promise<Site>;
  /** Returns the site with the new `qrCode`. */
  rotateSiteQr: (siteId: string) => Promise<Site>;
  createPost: (siteId: string, input: CreatePostInput) => Promise<Post>;
  updatePost: (postId: string, input: UpdatePostInput) => Promise<Post>;
  createEmployee: (input: CreateEmployeeInput) => Promise<Employee>;
  bulkImportEmployees: (siteId: string, input: BulkImportEmployeesInput) => Promise<BulkImportEmployeesResponse>;
  updateEmployee: (employeeId: string, input: UpdateEmployeeInput) => Promise<Employee>;
  createShift: (input: CreateShiftInput) => Promise<ShiftWithWarnings>;
  updateShift: (shiftId: string, input: UpdateShiftInput) => Promise<ShiftWithWarnings>;
  reassignShift: (shiftId: string, input: { version: number; employeeId: string | null }) => Promise<ShiftWithWarnings>;
  assignShiftOvertime: (shiftId: string, input: AssignShiftOvertimeInput) => Promise<Shift>;
  cancelShift: (shiftId: string, input: { version: number }) => Promise<Shift>;
  createShiftTemplate: (input: CreateShiftTemplateInput) => Promise<ShiftTemplateWithGeneration>;
  updateShiftTemplate: (templateId: string, input: UpdateShiftTemplateInput) => Promise<ShiftTemplateWithGeneration>;
  deactivateShiftTemplate: (templateId: string) => Promise<ShiftTemplate>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const organizationApi: OrganizationApi = USE_MOCKS ? organizationMockApi : organizationHttpApi;
