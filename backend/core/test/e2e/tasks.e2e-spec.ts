import { createHash } from 'node:crypto';
import type { TokenPair } from '../../src/auth/token.service';
import type { VerifiedActor } from '../../src/auth/verified-actor';
import { AUTH_PATTERNS } from '../../src/auth/auth.patterns';
import { generateUuidV7 } from '../../src/common/uuidv7';
import { ShiftLifecycleService } from '../../src/organization/shifts/shift-lifecycle.service';
import { bearer, CoreE2eApp, startCoreApp } from '../support/core-app';
import {
  cleanDatabase,
  closeDatabase,
  db,
  orgDb,
  tasksDb,
} from '../support/database';

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

    if (enableTasks && member.actor.tenantId) {
      const featuresJson = JSON.stringify({ tasks: true });
      await db().query('UPDATE auth.tenants SET features = $1 WHERE id = $2', [
        featuresJson,
        member.actor.tenantId,
      ]);
      await tasksDb().query(
        `INSERT INTO tasks.tenant_features (tenant_id, features, effective_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (tenant_id) DO UPDATE
           SET features = EXCLUDED.features, effective_at = EXCLUDED.effective_at`,
        [member.actor.tenantId, featuresJson],
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

  async function waitForEmployeeRecord(
    tenantId: string,
    userId: string,
    timeoutMs = 4_000,
  ): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = await orgDb().query<{ id: string }>(
        'SELECT id FROM organization.employees WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, userId],
      );
      if (result.rows[0]?.id) {
        return result.rows[0].id;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Timed out waiting for organization.employees projection for user ${userId}`,
    );
  }

  async function createSitePostAndActiveShift(
    owner: Member,
    employeeOrgId: string,
  ): Promise<{ siteId: string; postId: string; shiftId: string }> {
    const siteRes = await core
      .http()
      .post('/api/v1/sites')
      .set('Authorization', bearer(owner.tokens))
      .send({
        name: 'Central Site',
        address: 'Av. Siempreviva 742',
        latitude: -34.6037,
        longitude: -58.3816,
        geofenceRadiusMeters: 200,
        timezone: 'America/Argentina/Buenos_Aires',
      })
      .expect(201);

    const siteId = siteRes.body.id as string;

    const postRes = await core
      .http()
      .post(`/api/v1/sites/${siteId}/posts`)
      .set('Authorization', bearer(owner.tokens))
      .send({
        name: 'Main Gate',
      })
      .expect(201);

    const postId = postRes.body.id as string;

    await core
      .http()
      .patch(`/api/v1/employees/${employeeOrgId}`)
      .set('Authorization', bearer(owner.tokens))
      .send({ siteIds: [siteId] })
      .expect(200);

    const now = Date.now();
    const shiftRes = await core
      .http()
      .post('/api/v1/shifts')
      .set('Authorization', bearer(owner.tokens))
      .send({
        siteId,
        postId,
        employeeId: employeeOrgId,
        startsAt: new Date(now - 5 * 60_000).toISOString(),
        endsAt: new Date(now + 2 * 3600_000).toISOString(),
      })
      .expect(201);

    const shiftId = shiftRes.body.shift.id as string;

    await core.app.get(ShiftLifecycleService).tick(new Date(now));

    return { siteId, postId, shiftId };
  }

  describe('Unauthenticated and Feature Access', () => {
    it('rejects unauthenticated requests to forms with 401 invalid_token', async () => {
      const response = await core.http().get('/api/v1/forms').expect(401);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'invalid_token',
      });
    });

    it('rejects unauthenticated requests to tasks with 401 invalid_token', async () => {
      const response = await core.http().get('/api/v1/tasks').expect(401);

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
          name: 'Unauthorized Form',
          fields: [{ key: 'f1', label: 'Field 1', type: 'text', required: true }],
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
          siteId: generateUuidV7(),
          postId: generateUuidV7(),
          formVersionId: generateUuidV7(),
          deadlineMode: 'AFTER_START',
          deadlineMinutes: 60,
        })
        .expect(403);

      expect(response.body).toEqual({
        detail: expect.any(String) as string,
        code: 'forbidden',
      });
    });
  });

  describe('Complete Tasks & Forms Lifecycle', () => {
    it('executes full form publishing, template, task claiming, MinIO upload, answering and review flow', async () => {
      const owner = await registerOwner('lifecycle');
      const supervisor = await addMember(
        owner,
        'supervisor-lc@test.local',
        'supervisor',
      );
      const employee = await addMember(owner, 'employee-lc@test.local', 'employee');

      const employeeOrgId = await waitForEmployeeRecord(
        owner.actor.tenantId!,
        employee.actor.userId,
      );

      const { siteId, postId } = await createSitePostAndActiveShift(
        owner,
        employeeOrgId,
      );

      await core
        .http()
        .put(`/api/v1/auth/users/${supervisor.actor.userId}/sites`)
        .set('Authorization', bearer(owner.tokens))
        .send({ siteIds: [siteId] })
        .expect(200);

      // 1. Owner creates form draft
      const formCreated = await core
        .http()
        .post('/api/v1/forms')
        .set('Authorization', bearer(owner.tokens))
        .send({
          name: 'Daily Post Inspection',
          fields: [
            { key: 'f_notes', label: 'Guard Notes', type: 'text', required: true },
            { key: 'f_photo', label: 'Gate Photo', type: 'photo', required: true },
          ],
        })
        .expect(201);

      const formId = formCreated.body.id as string;
      expect(formCreated.body.name).toBe('Daily Post Inspection');

      // 2. Owner updates form draft
      const formUpdated = await core
        .http()
        .patch(`/api/v1/forms/${formId}`)
        .set('Authorization', bearer(owner.tokens))
        .send({
          name: 'Daily Post Inspection - Updated',
        })
        .expect(200);

      expect(formUpdated.body.name).toBe('Daily Post Inspection - Updated');

      // 3. Owner publishes form -> returns FormVersion
      const formPublished = await core
        .http()
        .post(`/api/v1/forms/${formId}/publish`)
        .set('Authorization', bearer(owner.tokens))
        .expect(201);

      const formVersionId = formPublished.body.id as string;
      expect(formPublished.body.formId).toBe(formId);
      expect(formPublished.body.version).toBe(1);

      // 4. Get form and list forms
      const formGet = await core
        .http()
        .get(`/api/v1/forms/${formId}`)
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(formGet.body.name).toBe('Daily Post Inspection - Updated');
      expect(formGet.body.versions).toHaveLength(1);

      const formsList = await core
        .http()
        .get('/api/v1/forms')
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(formsList.body.total).toBeGreaterThanOrEqual(1);
      expect(
        formsList.body.items.some((f: { id: string }) => f.id === formId),
      ).toBe(true);

      // 5. Owner creates task template
      const templateCreated = await core
        .http()
        .post('/api/v1/task-templates')
        .set('Authorization', bearer(owner.tokens))
        .send({
          siteId,
          postId,
          formVersionId,
          deadlineMode: 'AFTER_START',
          deadlineMinutes: 120,
        })
        .expect(201);

      const templateId = templateCreated.body.id as string;
      expect(templateCreated.body.deadlineMode).toBe('AFTER_START');

      const templatesList = await core
        .http()
        .get(`/api/v1/task-templates?siteId=${siteId}`)
        .set('Authorization', bearer(owner.tokens))
        .expect(200);

      expect(Array.isArray(templatesList.body)).toBe(true);
      expect(
        templatesList.body.some((t: { id: string }) => t.id === templateId),
      ).toBe(true);

      // 6. Supervisor creates an unassigned single task
      const taskCreated = await core
        .http()
        .post('/api/v1/tasks')
        .set('Authorization', bearer(supervisor.tokens))
        .send({
          siteId,
          postId,
          formVersionId,
          title: 'Gate Routine Check',
          deadline: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(201);

      const taskId = taskCreated.body.id as string;
      expect(taskCreated.body.status).toBe('PENDING');
      expect(taskCreated.body.employeeId).toBeNull();

      // 7. Employee claims the task while shift is IN_PROGRESS
      const taskClaimed = await core
        .http()
        .post(`/api/v1/tasks/${taskId}/claim`)
        .set('Authorization', bearer(employee.tokens))
        .expect(201);

      expect(taskClaimed.body.status).toBe('PENDING');
      expect(taskClaimed.body.employeeId).toBe(employeeOrgId);

      // 8. Employee requests media upload URL and uploads real bytes to MinIO
      const photoBytes = Buffer.from('e2e-jpeg-binary-payload-content');
      const sha256 = createHash('sha256').update(photoBytes).digest('hex');

      const mediaUpload = await core
        .http()
        .post('/api/v1/media/uploads')
        .set('Authorization', bearer(employee.tokens))
        .send({
          mime: 'image/jpeg',
          sizeBytes: photoBytes.length,
          sha256,
          takenAt: new Date().toISOString(),
        })
        .expect(201);

      const mediaId = mediaUpload.body.mediaId as string;
      const uploadUrl = mediaUpload.body.uploadUrl as string;
      expect(mediaId).toBeDefined();
      expect(uploadUrl).toBeDefined();

      const s3UploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: photoBytes,
      });
      expect(s3UploadRes.ok).toBe(true);

      // 9. Employee gets signed read URL for media
      const mediaUrl = await core
        .http()
        .get(`/api/v1/media/${mediaId}/url`)
        .set('Authorization', bearer(employee.tokens))
        .expect(200);

      expect(mediaUrl.body.url).toBeDefined();

      // 10. Employee answers the task (verifies photo in S3 & marks UPLOADED)
      const taskAnswered = await core
        .http()
        .post(`/api/v1/tasks/${taskId}/answer`)
        .set('Authorization', bearer(employee.tokens))
        .send({
          clientAnswerId: generateUuidV7(),
          deviceTime: new Date().toISOString(),
          answers: {
            f_notes: 'Gate is secure and operational.',
            f_photo: mediaId,
          },
        })
        .expect(201);

      expect(taskAnswered.body.status).toBe('COMPLETED');

      const mediaRow = await tasksDb().query<{ status: string }>(
        'SELECT status FROM tasks.media WHERE id = $1',
        [mediaId],
      );
      expect(mediaRow.rows[0]?.status).toBe('UPLOADED');

      // 11. Supervisor reviews the task
      const taskReviewed = await core
        .http()
        .post(`/api/v1/tasks/${taskId}/review`)
        .set('Authorization', bearer(supervisor.tokens))
        .send({
          result: 'APPROVED',
          note: 'Verified and approved.',
        })
        .expect(201);

      expect(taskReviewed.body.status).toBe('COMPLETED');
      expect(taskReviewed.body.answer.reviewResult).toBe('APPROVED');
      expect(taskReviewed.body.answer.reviewNote).toBe('Verified and approved.');
      expect(taskReviewed.body.answer.reviewedBy).toBe(supervisor.actor.userId);
    });
  });

  describe('Tenant Isolation', () => {
    it('prevents tenant B from accessing or mutating tasks and forms of tenant A', async () => {
      const ownerA = await registerOwner('iso-a');
      const ownerB = await registerOwner('iso-b');
      const employeeB = await addMember(ownerB, 'emp-iso-b@test.local', 'employee');

      await waitForEmployeeRecord(ownerB.actor.tenantId!, employeeB.actor.userId);

      // Tenant A creates and publishes a form
      const formA = await core
        .http()
        .post('/api/v1/forms')
        .set('Authorization', bearer(ownerA.tokens))
        .send({
          name: 'Secret Form Tenant A',
          fields: [
            {
              key: 'f_secret',
              label: 'Confidential Info',
              type: 'text',
              required: true,
            },
          ],
        })
        .expect(201);

      const formIdA = formA.body.id as string;

      const publishedA = await core
        .http()
        .post(`/api/v1/forms/${formIdA}/publish`)
        .set('Authorization', bearer(ownerA.tokens))
        .expect(201);

      const formVersionIdA = publishedA.body.id as string;

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
          siteId: generateUuidV7(),
          postId: generateUuidV7(),
          formVersionId: formVersionIdA,
          title: 'Tenant A Sensitive Task',
          deadline: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(201);

      const taskIdA = taskA.body.id as string;

      // Tenant B employee cannot get or claim Tenant A's task
      const forbiddenGet = await core
        .http()
        .get(`/api/v1/tasks/${taskIdA}`)
        .set('Authorization', bearer(employeeB.tokens))
        .expect(404);

      expect(forbiddenGet.body.code).toBe('task_not_found');

      const forbiddenClaim = await core
        .http()
        .post(`/api/v1/tasks/${taskIdA}/claim`)
        .set('Authorization', bearer(employeeB.tokens))
        .expect(404);

      expect(forbiddenClaim.body.code).toBe('task_not_found');
    });
  });
});
