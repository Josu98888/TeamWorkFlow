import { Injectable } from '@nestjs/common';

// Public facade of the module (the only export of OrganizationModule).
// Operations are added by the sites, employees and shifts sub-modules.
@Injectable()
export class OrganizationService {}
