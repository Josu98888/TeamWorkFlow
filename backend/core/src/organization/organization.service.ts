import { Injectable } from '@nestjs/common';
import type {
  CreateEmployeeBodyDto,
  ListEmployeesQueryDto,
  UpdateEmployeeBodyDto,
} from './employees/dto/employee.dto';
import { EmployeesService } from './employees/employees.service';
import type { OrganizationActor } from './organization-actor';
import type {
  CreatePostBodyDto,
  CreateSiteBodyDto,
  PageQueryDto,
  UpdatePostBodyDto,
  UpdateSiteBodyDto,
} from './sites/dto/site.dto';
import { PostsService } from './sites/posts.service';
import { SitesService } from './sites/sites.service';

// Public facade of the module (the only export of OrganizationModule).
// Operations are added by the sites, employees and shifts sub-modules; each
// method keeps the stable name of its `organization.<resource>.<action>`.
@Injectable()
export class OrganizationService {
  constructor(
    private readonly sites: SitesService,
    private readonly posts: PostsService,
    private readonly employees: EmployeesService,
  ) {}

  // organization.site.create
  createSite(actor: OrganizationActor, dto: CreateSiteBodyDto) {
    return this.sites.create(actor, dto);
  }

  // organization.site.update
  updateSite(actor: OrganizationActor, siteId: string, dto: UpdateSiteBodyDto) {
    return this.sites.update(actor, siteId, dto);
  }

  // organization.site.get
  getSite(actor: OrganizationActor, siteId: string) {
    return this.sites.get(actor, siteId);
  }

  // organization.site.list
  listSites(actor: OrganizationActor, query: PageQueryDto) {
    return this.sites.list(actor, query);
  }

  // organization.site.rotate-qr
  rotateSiteQr(actor: OrganizationActor, siteId: string) {
    return this.sites.rotateQr(actor, siteId);
  }

  // organization.post.create
  createPost(actor: OrganizationActor, siteId: string, dto: CreatePostBodyDto) {
    return this.posts.create(actor, siteId, dto);
  }

  // organization.post.update
  updatePost(actor: OrganizationActor, postId: string, dto: UpdatePostBodyDto) {
    return this.posts.update(actor, postId, dto);
  }

  // organization.post.list
  listPosts(actor: OrganizationActor, siteId: string, query: PageQueryDto) {
    return this.posts.list(actor, siteId, query);
  }

  // organization.employee.create
  createEmployee(actor: OrganizationActor, dto: CreateEmployeeBodyDto) {
    return this.employees.create(actor, dto);
  }

  // organization.employee.update
  updateEmployee(
    actor: OrganizationActor,
    employeeId: string,
    dto: UpdateEmployeeBodyDto,
  ) {
    return this.employees.update(actor, employeeId, dto);
  }

  // organization.employee.get (by `employeeId`)
  getEmployee(actor: OrganizationActor, employeeId: string) {
    return this.employees.get(actor, { employeeId });
  }

  // organization.employee.get (by `userId`, for other core modules)
  getEmployeeByUserId(actor: OrganizationActor, userId: string) {
    return this.employees.get(actor, { userId });
  }

  // organization.employee.get with an explicit tenant and no actor: the
  // background-style call behind the NATS responder (T5).
  getEmployeeForTenant(
    tenantId: string,
    lookup: { employeeId: string } | { userId: string },
  ) {
    return this.employees.getForTenant(tenantId, lookup);
  }

  // organization.employee.list
  listEmployees(actor: OrganizationActor, query: ListEmployeesQueryDto) {
    return this.employees.list(actor, query);
  }
}
