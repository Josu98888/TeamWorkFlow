import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../src/app.config';
import { AuthService } from '../src/auth/auth.service';
import { InvitationAcceptService } from '../src/auth/invitations/invitation-accept.service';
import { InvitationsController } from '../src/auth/invitations/invitations.controller';
import { InvitationsService } from '../src/auth/invitations/invitations.service';
import { PasswordResetConfirmService } from '../src/auth/password-reset/password-reset-confirm.service';
import { PasswordResetCreateService } from '../src/auth/password-reset/password-reset-create.service';
import { PasswordResetController } from '../src/auth/password-reset/password-reset.controller';
import { UserAssignSitesService } from '../src/auth/users/user-assign-sites.service';
import { UserChangeRoleService } from '../src/auth/users/user-change-role.service';
import { UserDeactivateService } from '../src/auth/users/user-deactivate.service';
import { UsersController } from '../src/auth/users/users.controller';
import { AuthGuard } from '../src/http/guards/auth.guard';

// Smoke test without DB or NATS: the real HTTP stack (prefix, pipe, filter,
// global guard, admin controllers) over mocked services. The full flow against
// real infrastructure is T6.6.
const ACTOR = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-00000000000a',
  role: 'admin',
  tenantStatus: 'active',
  plan: null,
  features: null,
};
const SERVICE_ACTOR = {
  userId: ACTOR.userId,
  tenantId: ACTOR.tenantId,
  role: ACTOR.role,
};
const USER_ID = '0199b7e0-0000-7000-8000-000000000002';
const INVITATION_ID = '0199b7e0-0000-7000-8000-0000000000c1';
const SITE_ID = '0199b7e0-0000-7000-8000-0000000000a1';

describe('Auth admin routes (e2e)', () => {
  let app: INestApplication;
  const auth = { verify: jest.fn() };
  const invitations = {
    create: jest.fn(),
    list: jest.fn(),
    regenerate: jest.fn(),
  };
  const accepts = { accept: jest.fn() };
  const changeRole = { changeRole: jest.fn() };
  const assignSites = { assignSites: jest.fn() };
  const deactivate = { deactivate: jest.fn() };
  const resetCreate = { create: jest.fn() };
  const resetConfirm = { confirm: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        InvitationsController,
        UsersController,
        PasswordResetController,
      ],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: InvitationsService, useValue: invitations },
        { provide: InvitationAcceptService, useValue: accepts },
        { provide: UserChangeRoleService, useValue: changeRole },
        { provide: UserAssignSitesService, useValue: assignSites },
        { provide: UserDeactivateService, useValue: deactivate },
        { provide: PasswordResetCreateService, useValue: resetCreate },
        { provide: PasswordResetConfirmService, useValue: resetConfirm },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    auth.verify.mockResolvedValue(ACTOR);
  });

  it.each([
    ['post', '/api/auth/invitations'],
    ['get', '/api/auth/invitations'],
    ['post', `/api/auth/invitations/${INVITATION_ID}/regenerate`],
    ['patch', `/api/auth/users/${USER_ID}/role`],
    ['put', `/api/auth/users/${USER_ID}/sites`],
    ['post', `/api/auth/users/${USER_ID}/deactivate`],
    ['post', `/api/auth/users/${USER_ID}/password-reset`],
  ] as const)(
    'answers 401 on guarded %s %s without a token',
    async (verb, path) => {
      const response = await request(app.getHttpServer())
        [verb](path)
        .expect(401);

      expect((response.body as { code: string }).code).toBe('invalid_token');
    },
  );

  it('creates an invitation with the actor from the verified token', async () => {
    invitations.create.mockResolvedValue({ invitationId: 'i' });

    await request(app.getHttpServer())
      .post('/api/auth/invitations')
      .set('Authorization', 'Bearer good')
      .send({ email: 'Eva@Acme.test', role: 'employee' })
      .expect(201);

    expect(invitations.create).toHaveBeenCalledWith({
      email: 'eva@acme.test',
      role: 'employee',
      actor: SERVICE_ACTOR,
    });
  });

  it('rejects an actor or tenantId in the body with 422', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/invitations')
      .set('Authorization', 'Bearer good')
      .send({
        email: 'eva@acme.test',
        role: 'employee',
        actor: { role: 'owner' },
        tenantId: ACTOR.tenantId,
      })
      .expect(422);

    expect((response.body as { code: string }).code).toBe('validation_error');
    expect(invitations.create).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid path param with 422', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/users/not-a-uuid/deactivate')
      .set('Authorization', 'Bearer good')
      .expect(422);

    expect(deactivate.deactivate).not.toHaveBeenCalled();
  });

  it('changes a role merging body, params and actor', async () => {
    changeRole.changeRole.mockResolvedValue({ ok: true });

    const response = await request(app.getHttpServer())
      .patch(`/api/auth/users/${USER_ID}/role`)
      .set('Authorization', 'Bearer good')
      .send({ role: 'supervisor' })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(changeRole.changeRole).toHaveBeenCalledWith({
      role: 'supervisor',
      userId: USER_ID,
      actor: SERVICE_ACTOR,
    });
  });

  it('assigns sites with PUT', async () => {
    assignSites.assignSites.mockResolvedValue({ ok: true });

    await request(app.getHttpServer())
      .put(`/api/auth/users/${USER_ID}/sites`)
      .set('Authorization', 'Bearer good')
      .send({ siteIds: [SITE_ID] })
      .expect(200);

    expect(assignSites.assignSites).toHaveBeenCalledWith({
      siteIds: [SITE_ID],
      userId: USER_ID,
      actor: SERVICE_ACTOR,
    });
  });

  it('serves the public accept and confirm routes without a token', async () => {
    accepts.accept.mockResolvedValue({ accessToken: 'a' });
    resetConfirm.confirm.mockResolvedValue({ ok: true });

    await request(app.getHttpServer())
      .post('/api/auth/invitations/accept')
      .send({ token: 't', name: 'Eva', password: 'password-1' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/password-reset/confirm')
      .send({ token: 't', password: 'password-2' })
      .expect(201);

    expect(auth.verify).not.toHaveBeenCalled();
    expect(accepts.accept).toHaveBeenCalledWith({
      token: 't',
      name: 'Eva',
      password: 'password-1',
    });
  });

  it('does not route list-recipients', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/users/list-recipients')
      .set('Authorization', 'Bearer good')
      .send({ tenantId: ACTOR.tenantId, roles: ['employee'] })
      .expect(404);
  });
});
