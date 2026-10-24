---
name: teamworkflow-test-ui
description: >
  Playwright E2E testing for the TeamWorkFlow frontend: setup, MCP exploration workflow, Page Objects,
  selectors, wait strategies, test data via the public HTTP API of the NestJS backend, tags/IDs, scope detection and
  test documentation.
  Trigger: When setting up Playwright, writing or modifying E2E tests under frontend/tests/,
  or working with Page Objects and test helpers.
  Structure and placement come from teamworkflow-frontend (source of truth).
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.1"
  scope: [root, frontend]
  auto_invoke:
    - "Writing TeamWorkFlow E2E tests"
    - "Writing Playwright E2E tests"
    - "Working with TeamWorkFlow test helpers/pages"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – E2E Tests (Playwright)

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. **Playwright is not installed and no tests exist yet.**

- Check `frontend/package.json` for `@playwright/test`. If missing, do NOT write tests yet: ask the user to set up Playwright (see "Setup").
- Before creating a Page Object or helper, search `frontend/tests/` for an existing one.
- Auth is not implemented yet. Tests that need a logged-in user wait for it (`// TODO(auth):`).
- Test data comes from the public HTTP API of the NestJS backend (`core`: global prefix `/api`, port 3000; `telemetry` routes under `/api/v1/telemetry`, port 3003; today `core` is still `backend/gateway`). NEVER run E2E tests against a production or shared database.

---

## Critical Rules

- Explore the real page first (Playwright MCP if available) — never write selectors from assumptions.
- Selectors by role and accessible name first. NEVER CSS classes, XPath, ids or Tailwind classes.
- NEVER `networkidle`, NEVER `waitForTimeout`, NEVER `waitForSelector`. Use web-first assertions.
- Every test is independent: it creates its own data and never depends on another test's state or order.
- Test data is created through the backend API, not by clicking through the UI (unless the UI flow is what's being tested).
- Unique values for created data (`uniqueName()`, `uniqueEmail()`), so parallel runs don't collide.
- URL and page-load assertions live in Page Objects, not in tests.
- Reuse existing Page Objects and helpers. Never re-implement an action another Page Object already has.
- ONE spec file per feature. A test change is NOT complete until its `.md` documentation is updated.
- Credentials and secrets come from env vars, never hardcoded.
- `import type` for Playwright types (teamworkflow-typescript).

---

## Scope Detection (ASK IF AMBIGUOUS)

| User says | Action |
|-----------|--------|
| "a test", "one test", "add a test for…" | Add ONE `test()` to the feature's existing spec (create the spec if missing) |
| "tests for…", "E2E tests for the X page", "test suite", "cover X" | Create the full suite for that feature |
| Unclear | Ask before writing |

Examples:

- "Add a test that creating a project shows a success message" → ONE test in `projects.spec.ts`.
- "Generate E2E tests for the tasks page" → full suite in `tasks.spec.ts` + Page Object + `.md`.

Write the minimum tests that cover what exists. Do not test features that aren't built yet.

---

## Setup (once, after user confirmation)

```bash
cd frontend
<pm> install -D @playwright/test        # <pm> = detected package manager
npx playwright install --with-deps chromium
```

```ts
// frontend/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "<pm> run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
  // TODO(e2e-backend): add a second webServer entry for the backend (`core`, plus `telemetry` for attendance flows) once the backend
  // start command (or `docker compose up` in backend/) and a TEST database are confirmed.
});
```

```bash
# frontend/.env.example — add
E2E_BASE_URL=http://localhost:3000
E2E_BACKEND_URL=http://localhost:3000/api/   # core public API; keep the trailing slash
```

Recommended scripts (ask before adding):

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

Add to `.gitignore`: `test-results/`, `playwright-report/`, `playwright/.auth/`.

---

## Test Structure

```text
frontend/tests/
├── base-page.ts                 # Parent class for ALL Page Objects
├── helpers/
│   ├── backend.ts               # API context + seeding/cleanup helpers (NestJS backend)
│   └── data.ts                  # uniqueName(), uniqueEmail(), test data builders
└── <feature>/                   # one folder per feature: projects, tasks, teams, auth
    ├── <feature>-page.ts        # Page Object
    ├── <feature>.spec.ts        # ALL tests for the feature (single file)
    └── <feature>.md             # Test documentation (MANDATORY, synced with spec)
```

Create each file when the first test needs it.

### File naming

```text
✅ projects.spec.ts          all project tests
✅ projects-page.ts          Page Object
✅ projects.md               documentation
❌ projects-validation.spec.ts      no split spec files per scenario
❌ projects-critical-path.spec.ts
```

Group scenarios inside the single spec with `test.describe` if needed.

---

## MCP Workflow (MANDATORY if available)

If Playwright MCP tools are available, ALWAYS use them BEFORE writing a test:

1. **Navigate** to the target page (dev server running).
2. **Snapshot** the accessibility tree to see real roles and names.
3. **Interact** with forms and controls to verify the exact user flow.
4. **Verify transitions** through the whole flow: loading, success and error states.
5. **Screenshot** key states to document what is expected.
6. **Note the real selectors** from the snapshot (real roles and labels).
7. **Only then** write the Page Object and spec.

If MCP is not available, read the components in `domains/<domain>/components/` to derive roles, labels and texts — and tell the user selectors were not verified against a running app.

Never assume how the UI "should" work. Test what actually exists.

---

## Selectors (priority order)

| Priority | Locator | Use for |
|----------|---------|---------|
| 1 | `getByRole("button", { name: "Save project" })` | Buttons, links, headings, tables, dialogs, comboboxes |
| 2 | `getByLabel("Title")` | Form fields |
| 3 | `getByText("No projects yet")` | Static content only (messages, empty states) |
| 4 | `getByTestId("project-row")` | Last resort, when no accessible locator exists |

```ts
// ❌ NEVER
page.locator(".bg-primary.rounded-md");
page.locator("#email");
page.locator("//div[2]/button");
page.locator("#radix-:r3:");                 // generated ids change
```

- If an element has no accessible name, fix the component (label, `aria-label`) instead of adding a `data-testid` — that also fixes accessibility (teamworkflow-frontend).
- `data-testid` naming: kebab-case, `<domain>-<element>` (`project-row`).

### shadcn components

```ts
// Select (Radix) — NOT a native <select>, selectOption() won't work
await page.getByRole("combobox", { name: "Task" }).click();
await page.getByRole("option", { name: "Fix login bug" }).click();

// Dialog
const dialog = page.getByRole("dialog", { name: "Delete project" });
await dialog.getByRole("button", { name: "Delete" }).click();
await expect(dialog).toBeHidden();

// Checkbox / Switch
await page.getByRole("checkbox", { name: "Available" }).check();
await page.getByRole("switch", { name: "Notifications" }).click();
```

---

## Wait Strategies (CRITICAL)

| Strategy | Use case |
|----------|----------|
| ❌ `waitForLoadState("networkidle")` | NEVER — flaky with streaming, polling, Server Actions |
| ❌ `waitForTimeout(ms)` | NEVER — arbitrary waits |
| ❌ `waitForSelector(…)` | NEVER — use locators + web-first assertions |
| ⚠️ `waitForLoadState("load")` | Only when absolutely necessary |
| ✅ `await expect(locator).toBeVisible()` | Wait for a specific UI state |
| ✅ `await expect(page).toHaveURL(…)` | Wait for navigation (inside Page Objects) |
| ✅ `await pageObject.verifyPageLoaded()` | BEST — encapsulated page readiness |

```ts
// ✅ Web-first assertions auto-retry
await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
await expect(page.getByRole("button", { name: "Save project" })).toBeEnabled(); // pending finished

// ❌ Immediate checks don't retry
expect(await page.getByText("Saved").isVisible()).toBe(true);
```

### Next.js specifics

- **Streaming / Suspense:** wait for the final content, not for the fallback to disappear: `await expect(page.getByRole("table")).toBeVisible()`.
- **Server Actions:** after submit, wait for the result (redirect, success message, or the button leaving its pending state), never a fixed delay.
- **Dev server compile:** the first navigation can be slow in `next dev`. Don't add timeouts; raise the `expect` timeout in config only if consistently needed.

---

## Base Page

All Page Objects extend `BasePage`. It holds ONLY behavior shared by every page.

```ts
// frontend/tests/base-page.ts
import { expect, type Locator, type Page } from "@playwright/test";

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  protected async open(path: string): Promise<void> {
    await this.page.goto(path);
    await this.verifyPageLoaded();
  }

  // Each page overrides this to wait for its own key element
  abstract verifyPageLoaded(): Promise<void>;

  // TODO(toasts): adjust the locator to the toast library chosen (e.g. sonner)
  protected notification(): Locator {
    return this.page.getByRole("status");
  }

  async verifyNotification(message: string | RegExp): Promise<void> {
    await expect(this.notification()).toContainText(message);
  }
}
```

---

## Page Objects

```ts
// frontend/tests/projects/projects-page.ts
import { expect, type Page } from "@playwright/test";
import { BasePage } from "../base-page";

export class ProjectsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  readonly heading = this.page.getByRole("heading", { name: "Projects" });
  readonly newProjectButton = this.page.getByRole("button", { name: "New project" });
  readonly table = this.page.getByRole("table");

  async goto(): Promise<void> {
    await this.open("/projects");
  }

  async verifyPageLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async verifyOnProjectsPage(): Promise<void> {
    await expect(this.page).toHaveURL(/\/projects$/);
    await this.verifyPageLoaded();
  }

  async createProject(projectName: string, teamName: string): Promise<void> {
    await this.newProjectButton.click();
    await this.page.getByLabel("Name").fill(projectName);
    await this.page.getByRole("combobox", { name: "Team" }).click();
    await this.page.getByRole("option", { name: teamName }).click();
    await this.page.getByRole("button", { name: "Save project" }).click();
  }

  projectRow(text: string) {
    return this.table.getByRole("row").filter({ hasText: text });
  }
}
```

Rules:

- Page Objects expose **locators** and **user actions** (`createProject`), not low-level steps.
- URL and page-load assertions live here: `verifyPageLoaded()`, `verifyOn<PageName>Page()`.
- Business assertions (row exists, value shown) stay in the spec.
- One Page Object per page. Never duplicate locators in specs.

### Page Object reuse (CRITICAL)

Before creating a Page Object or an action, check `tests/` for an existing one. A flow that crosses pages uses each page's own Page Object.

```ts
// ✅ Reuse existing Page Objects across features
import { LoginPage } from "../auth/login-page";
import { ProjectsPage } from "../projects/projects-page";

test("user logs in and creates a project", async ({ page }) => {
  const loginPage = new LoginPage(page);       // REUSE
  const projectsPage = new ProjectsPage(page);   // REUSE

  await loginPage.goto();
  await loginPage.login(credentials);
  await projectsPage.verifyOnProjectsPage();
  await projectsPage.createProject(projectName, teamName);
});
```

```ts
// ❌ Re-implementing actions that belong to another page
export class ProjectsPage extends BasePage {
  async login() { /* … */ }   // ❌ LoginPage already has this
  async logout() { /* … */ }  // ❌ belongs to the page that owns the logout control
}
```

If a test needs several pages, make sure each has its Page Object (create the missing ones).

---

## Where Shared Test Code Goes

| Code | Location |
|------|----------|
| Behavior every page has (notifications, page-load contract) | `base-page.ts` |
| Behavior of one page | That page's Page Object |
| Unique values, test data builders | `helpers/data.ts` |
| Seeding / cleanup through the backend API | `helpers/backend.ts` |
| Assertions for one feature | The feature's spec |

If the same code appears in two Page Objects, move it to `BasePage` (if every page has it) or to `helpers/` (if it isn't page behavior). Do not add helpers "just in case".

---

## Test Data (NestJS backend)

E2E tests run against a TEST database. Seed and clean up through the public HTTP API (never talk to NATS or an internal service from tests).

```ts
// frontend/tests/helpers/data.ts
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function uniqueEmail(prefix = "e2e"): string {
  return `${uniqueName(prefix)}@example.com`;
}
```

```ts
// frontend/tests/helpers/backend.ts
import { request, type APIRequestContext } from "@playwright/test";

export async function backendContext(): Promise<APIRequestContext> {
  return request.newContext({
    // Trailing slash + relative paths (no leading "/") so the "/api" prefix is kept
    baseURL: process.env.E2E_BACKEND_URL ?? "http://localhost:3000/api/",
  });
}

// TODO(e2e-backend): confirm endpoints and DTO payloads in the `core` controllers (route map in `backend/core/AGENTS.md`) before using (they may not exist yet).
export async function seedTeam(api: APIRequestContext, data: { name: string }) {
  const res = await api.post("teams", { data });
  if (!res.ok()) throw new Error(`Seed team failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; name: string };
}

// Deleting the team also removes its projects (cascade owned by the backend).
export async function deleteTeam(api: APIRequestContext, id: string) {
  await api.delete(`teams/${id}`);
}
```

- Field names and endpoints mirror the backend controllers and DTOs (camelCase). Check `backend/core/src/` (or `backend/telemetry/src/`; until T6 `backend/gateway/src/`) before writing a helper. Failed requests return `{ detail, code }` (teamworkflow-nest): include both in the thrown error.
- Clean up what each test creates (`afterEach` / `afterAll`), or rely on a test DB reset if the backend provides one.
- NEVER hardcode IDs of existing records.

---

## Specs, Tags and IDs

```ts
// frontend/tests/projects/projects.spec.ts
import { test, expect, type APIRequestContext } from "@playwright/test";
import { ProjectsPage } from "./projects-page";
import { backendContext, seedTeam, deleteTeam } from "../helpers/backend";
import { uniqueName } from "../helpers/data";

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await backendContext();
});

test.afterAll(async () => {
  await api.dispose();
});

test.describe("Projects", () => {
  test(
    "user creates a project for their team",
    { tag: ["@critical", "@e2e", "@projects", "@PROJECT-E2E-001"] },
    async ({ page }) => {
      const team = await seedTeam(api, { name: uniqueName("Platform team") });
      const projectName = uniqueName("Website redesign");

      try {
        const projectsPage = new ProjectsPage(page);
        await projectsPage.goto();
        await projectsPage.createProject(projectName, team.name);

        await projectsPage.verifyNotification("Project created");
        await expect(projectsPage.projectRow(projectName)).toBeVisible();
      } finally {
        await deleteTeam(api, team.id);
      }
    },
  );
});
```

### Tags

| Category | Tags |
|----------|------|
| Priority | `@critical`, `@high`, `@medium`, `@low` |
| Type | `@e2e`, `@smoke`, `@regression` |
| Feature | `@projects`, `@tasks`, `@teams`, `@auth` (add as domains appear) |
| Test ID | `@<SUITE>-E2E-<NNN>` |

Suite IDs: `PROJECT`, `TASK`, `TEAM`, `AUTH`. Add new suites when new features get tests. IDs are never reused.

### What to cover with E2E

- Critical user flows end to end (create/edit/delete a project, search tasks, auth once it exists).
- Redirects and access control.
- NOT every validation message or visual variant — those belong in lower-level tests.

---

## Auth (NOT IMPLEMENTED YET)

When auth exists:

- Create `tests/auth/login-page.ts` with `login()` and `verifyOnLoginPage()`.
- Create a setup project `tests/auth.setup.ts` that logs in once and saves `storageState` to `playwright/.auth/user.json`.
- Add it to `projects` with `dependencies: ["setup"]` and `use: { storageState: "playwright/.auth/user.json" }`.
- Test credentials come from env vars (`E2E_USER_EMAIL`, `E2E_USER_PASSWORD`), never hardcoded.
- Add `@auth` tests for login, logout and protected-route redirects.

Until then: `// TODO(auth):`.

---

## Test Documentation (MANDATORY)

Each feature folder has `<feature>.md`, synced with the spec.

```markdown
# E2E Tests: {Feature Name}

**Suite ID:** `{SUITE}`
**Feature:** {Short description}

---

## Test Case: `{SUITE}-E2E-{NNN}` - {Title}

**Priority:** `{critical|high|medium|low}`
**Tags:** @e2e, @{feature}

**Objective:** {One sentence}

**Preconditions:**
- {Data seeded via backend, user state…}

### Flow Steps
1. {Step}
2. {Step}

### Expected Result
- {Outcome}

### Key Verification Points
- {Assertion}

### Notes
- {Only if needed}
```

Documentation rules:

- ✅ Only the specific test cases: objective, preconditions, steps, expected results.
- ✅ Keep it under 60 lines when possible.
- ❌ No instructions on how to run tests.
- ❌ No file structure explanations.
- ❌ No code examples or tutorials.
- ❌ No troubleshooting sections.

### When creating tests

- [ ] `<feature>-page.ts` created/updated (or existing Page Objects reused)
- [ ] `<feature>.spec.ts` tests with priority, type, feature and ID tags
- [ ] `<feature>.md` documents ALL test cases
- [ ] IDs in `.md` match tags in `.spec.ts`

### When modifying tests

Update `<feature>.md` if test cases, steps, preconditions, expected results, tags or priorities changed.

### Quick validation

```bash
cd frontend
grep -o "@[A-Z]*-E2E-[0-9]*" tests/<feature>/<feature>.spec.ts | tr -d '@' | sort -u
grep -o "\`[A-Z]*-E2E-[0-9]*\`" tests/<feature>/<feature>.md | tr -d '`' | sort -u
```

Both lists must be identical.

---

## Commands

Use the detected package manager and only scripts that exist. With npm, pass extra args after `--`.

```bash
cd frontend && <pm> run test:e2e                          # all tests
cd frontend && <pm> run test:e2e -- tests/projects/        # one feature
cd frontend && <pm> run test:e2e -- --grep "@critical"    # by tag
cd frontend && <pm> run test:e2e -- --grep "@PROJECT-E2E-001"
cd frontend && <pm> run test:e2e:ui                       # UI mode
cd frontend && <pm> run test:e2e:debug                    # debug
cd frontend && <pm> run test:e2e:report                   # open report
```

If the scripts don't exist yet: `cd frontend && npx playwright test`.

---

## Checklist

- [ ] Playwright installed and configured (or user asked first)
- [ ] Scope matches the request (one test vs full suite)
- [ ] Real page explored (MCP) including loading/success/error states, or selectors flagged as unverified
- [ ] Role/label/text selectors; no CSS/XPath/ids
- [ ] No `networkidle`, `waitForTimeout` or `waitForSelector`; web-first assertions only
- [ ] Existing Page Objects and helpers reused; no duplicated actions or locators
- [ ] Shared code in `BasePage` / `helpers/` per "Where Shared Test Code Goes"
- [ ] One spec file per feature
- [ ] Test data seeded via backend with unique values; cleaned up; TEST database only
- [ ] Tests independent and parallel-safe
- [ ] URL/page-load assertions in Page Objects
- [ ] Tags: priority + type + feature + unique ID
- [ ] `<feature>.md` created/updated, IDs in sync, no tutorials or run instructions
- [ ] Credentials from env vars; Playwright types with `import type`