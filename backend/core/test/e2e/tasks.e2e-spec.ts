import type { TokenPair } from '../../src/auth/token.service';
import type { VerifiedActor } from '../../src/auth/verified-actor';
import { AUTH_PATTERNS } from '../../src/auth/auth.patterns';
import { bearer, CoreE2eApp, startCoreApp } from '../support/core-app';
import { cleanDatabase, closeDatabase, db } from '../support/database';

interface Member {
  tokens: TokenPair;
  actor: VerifiedActor;
}

describe('Tasks E2E Suite', () => {
  let core: CoreE2eApp;

  beforeAll(async () => {
    core = await startCoreApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await core?.close();
    await closeDatabase();
  });

  async function toMember(tokens: TokenPair): Promise<Member> {
    const actor = await core.send<VerifiedActor>(AUTH_PATTERNS.tokenVerify, {
      accessToken: tokens.accessToken,
    });
    return { tokens, actor };
  }

  async function registerOwner(tag: string, enableTasks = true): Promise<Member> {
    const response = await core
      .http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Tasks Tenant ${tag}`,
        name: `Owner ${tag}`,
        email: `tasks-owner-${tag}@test.local`,
        password: 'secure-password-123',
      })
      .expect(201);

    const member = await toMember(response.body as TokenPair);

    if (enableTasks) {
      await db().query(
        'UPDATE auth.tenants SET features = $1 WHERE id = $2',
        [JSON.stringify({ tasks: true }), member.actor.tenantId],
      );
    }

    return member;
  }

  async function addMember(
    ownerMember: Member,
    email: string,
    role: 'admin' | 'supervisor' | 'employee',
  ): Promise<Member> {
    const invitation = (
      await core
        .http()
        .post('/api/v1/auth/invitations')
        .set('Authorization', bearer(ownerMember.tokens))
        .send({ email, role })
        .expect(201)
    ).body as { token: string };

    const accepted = await core
      .http()
      .post('/api/v1/auth/invitations/accept')
      .send({
        token: invitation.token,
        name: `Member ${role}`,
        password: 'member-password-123',
      })
      .expect(201);

    return toMember(accepted.body as TokenPair);
  }

  describe('Unauthenticated and Feature Access', () => {
    it('rejects unauthenticated requests to forms with 401 invalid_token', async () => {
      const response = await core
        .http()
        .get('/api/v1/forms')
        .expect(401);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'invalid_token',
      });
    });

    it('rejects unauthenticated requests to tasks with 401 invalid_token', async () => {
      const response = await core
        .http()
        .get('/api/v1/tasks')
        .expect(401);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'invalid_token',
      });
    });

    it('rejects requests when tasks feature is not in tenant plan with 403 feature_not_in_plan', async () => {
      const ownerWithoutTasks = await registerOwner('no-tasks', false);

      const response = await core
        .http()
        .get('/api/v1/forms')
        .set('Authorization', bearer(ownerWithoutTasks.tokens))
        .expect(403);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'feature_not_in_plan',
      });
    });
  });

  describe('Role Authorization', () => {
    it('blocks employee from creating a form with 403 forbidden', async () => {
      const owner = await registerOwner('roles');
      const employee = await addMember(owner, 'employee-roles@test.local', 'employee');

      const response = await core
        .http()
        .post('/api/v1/forms')
        .set('Authorization', bearer(employee.tokens))
        .send({
          code: 'EMP_FORM',
          title: 'Unauthorized Form',
          fields: [{ id: 'f1', label: 'Field 1', type: 'TEXT', required: true }],
        })
        .expect(403);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'forbidden',
      });
    });

    it('blocks employee from creating a task template with 403 forbidden', async () => {
      const owner = await registerOwner('roles-tpl');
      const employee = await addMember(owner, 'employee-tpl@test.local', 'employee');

      const response = await core
        .http()
        .post('/api/v1/task-templates')
        .set('Authorization', bearer(employee.tokens))
        .send({
          siteId: 'site-1',
          postId: 'post-1',
          formId: 'form-1',
          title: 'Template 1',
          triggerType: 'ON_SHIFT_START',
          deadlineMinutes: 60,
          required: true,
          requiresReview: false,
        })
        .expect(403);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'forbidden',
      });
    });
  });

  describe('Complete Tasks & Forms Lifecycle', () => {
    it('executes full form publishing, template, task claiming, answering and review flow', async () => {
      const owner = await registerOwner('lifecycle');
      const supervisor = await addMember(owner, 'supervisor-lc@test.local', 'supervisor');
      const employee = await addMember(owner, 'employee-lc@test.local', 'employee');

      // 1. Owner creates form draft
      const formCreated = await core
        .http()
        .post('/api/v1/forms')
        .set('Authorization', bearer(owner.tokens))
        .send({
          code: 'INSP_DAILY',
          title: 'Daily Post Inspection',
          description: 'Standard daily equipment and guard check',
          fields: [
            { id: 'f_notes', label: 'Guard Notes', type: 'TEXT', required: true },
            { id: 'f_photo', label: 'Gate Photo', type: 'PHOTO', required: true },
          ],
        })
        .expect(201);

      const formId = formCreated.body.id as string;
      expect(formCreated.body.status).toBe('DRAFT');
      expect(formCreated.body.version).toBe(1);

      // 2. Owner updates form draft
      const formUpdated = await core
        .http()
        .patch(`/api/v1/forms/${formId}`)
        .set('Authorization', bearer(owner.tokens))
        .send({
          title: 'Daily Post Inspection - Updated',
        })
        .expect(200);

      expect(formUpdated.body.title).toBe('Daily Post Inspection - Updated');

      // 3. Owner publishes form
      const formPublished = await core
        .http()
        .post(`/api/v1/forms/${formId}/publish`)
        .set('Authorization', bearer(owner.tokens))
        .expect(200);

      expect(formPublished.body.status).toBe('PUBLISHED');

      // 4. Get form and list forms
      const formGet = await core
        .http()
        .get(`/api/v1/forms/${formId}`)
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(formGet.body.code).toBe('INSP_DAILY');

      const formsList = await core
        .http()
        .get('/api/v1/forms')
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(Array.isArray(formsList.body)).toBe(true);
      expect(formsList.body.some((f: { id: string }) => f.id === formId)).toBe(true);

      // 5. Owner creates task template
      const templateCreated = await core
        .http()
        .post('/api/v1/task-templates')
        .set('Authorization', bearer(owner.tokens))
        .send({
          siteId: 'site-a',
          postId: 'post-a',
          formId,
          title: 'Template - Daily Inspection',
          triggerType: 'ON_SHIFT_START',
          deadlineMinutes: 120,
          required: true,
          requiresReview: true,
        })
        .expect(201);

      const templateId = templateCreated.body.id as string;
      expect(templateCreated.body.triggerType).toBe('ON_SHIFT_START');

      const templatesList = await core
        .http()
        .get('/api/v1/task-templates?siteId=site-a')
        .set('Authorization', bearer(owner.tokens))
        .expect(200);

      expect(Array.isArray(templatesList.body)).toBe(true);
      expect(templatesList.body.some((t: { id: string }) => t.id === templateId)).toBe(true);

      // 6. Supervisor creates an ad-hoc task
      const taskCreated = await core
        .http()
        .post('/api/v1/tasks')
        .set('Authorization', bearer(supervisor.tokens))
        .send({
          siteId: 'site-a',
          postId: 'post-a',
          formId,
          title: 'Gate Routine Check',
          type: 'AD_HOC',
          dueAt: new Date(Date.now() + 3600_000).toISOString(),
          required: true,
          requiresReview: true,
        })
        .expect(201);

      const taskId = taskCreated.body.id as string;
      expect(taskCreated.body.status).toBe('PENDING');

      // 7. Employee claims the task
      const taskClaimed = await core
        .http()
        .post(`/api/v1/tasks/${taskId}/claim`)
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(taskClaimed.body.status).toBe('IN_PROGRESS');

      // 8. Employee requests media upload presigned URL
      const mediaUpload = await core
        .http()
        .post('/api/v1/media/uploads')
        .set('Authorization', bearer(employee.tokens))
        .send({
          taskId,
          fieldId: 'f_photo',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
        })
        .expect(201);

      const mediaId = mediaUpload.body.mediaId as string;
      expect(mediaUpload.body.uploadUrl).toBeDefined();

      // 9. Employee gets download URL for media
      const mediaUrl = await core
        .http()
        .get(`/api/v1/media/${mediaId}/url`)
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(mediaUrl.body.url).toBeDefined();

      // 10. Employee answers the task
      const taskAnswered = await core
        .http()
        .post(`/api/v1/tasks/${taskId}/answer`)
        .set('Authorization', bearer(employee.tokens))
        .send({
          clientAnswerId: 'ans-e2e-1',
          deviceTime: new Date().toISOString(),
          answers: {
            f_notes: 'Gate is secure and operational.',
            f_photo: mediaId,
          },
        })
        .expect(200);

      expect(taskAnswered.body.status).toBe('COMPLETED');

      // 11. Supervisor reviews the task
      const taskReviewed = await core
        .http()
        .post(`/api/v1/tasks/${taskId}/review`)
        .set('Authorization', bearer(supervisor.tokens))
        .send({
          result: 'APPROVED',
          note: 'Verified and approved.',
        })
        .expect(200);

      expect(taskReviewed.body.status).toBe('REVIEWED');
      expect(taskReviewed.body.reviewStatus).toBe('APPROVED');
      expect(taskReviewed.body.reviewedByUserId).toBe(supervisor.actor.userId);
    });
  });

  describe('Tenant Isolation', () => {
    it('prevents tenant B from accessing or mutating tasks and forms of tenant A', async () => {
      const ownerA = await registerOwner('iso-a');
      const ownerB = await registerOwner('iso-b');
      const employeeB = await addMember(ownerB, 'emp-iso-b@test.local', 'employee');

      // Tenant A creates a form
      const formA = await core
        .http()
        .post('/api/v1/forms')
        .set('Authorization', bearer(ownerA.tokens))
        .send({
          code: 'ISO_FORM_A',
          title: 'Secret Form Tenant A',
          fields: [{ id: 'f_secret', label: 'Confidential Info', type: 'TEXT', required: true }],
        })
        .expect(201);

      const formIdA = formA.body.id as string;

      // Tenant B owner cannot get Tenant A's form
      const forbiddenFormGet = await core
        .http()
        .get(`/api/v1/forms/${formIdA}`)
        .set('Authorization', bearer(ownerB.tokens))
        .expect(404);

      expect(forbiddenFormGet.body.code).toBe('form_not_found');

      // Tenant A creates a task
      const taskA = await core
        .http()
        .post('/api/v1/tasks')
        .set('Authorization', bearer(ownerA.tokens))
        .send({
          siteId: 'site-a',
          postId: 'post-a',
          formId: formIdA,
          title: 'Tenant A Sensitive Task',
          type: 'AD_HOC',
          dueAt: new Date(Date.now() + 3600_000).toISOString(),
          required: false,
          requiresReview: false,
        })
        .expect(201);

      const taskIdA = taskA.body.id as string;

      // Tenant B employee cannot claim Tenant A's task
      const forbiddenClaim = await core
        .http()
        .post(`/api/v1/tasks/${taskIdA}/claim`)
        .set('Authorization', bearer(employeeB.tokens))
        .expect(404);

      expect(forbiddenClaim.body.code).toBe('task_not_found');
    });
  });
});
