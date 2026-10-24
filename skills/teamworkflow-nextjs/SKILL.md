---
name: teamworkflow-nextjs
description: >
  Next.js 16 App Router patterns for TeamWorkFlow.
  Trigger: When creating or editing pages, layouts, Server Actions, Route Handlers, proxy.ts,
  data fetching, caching/revalidation, Cache Components, metadata or streaming in frontend/.
  Structure, imports and placement rules come from teamworkflow-frontend (source of truth).
  For React 19 component/hook rules, also use teamworkflow-react.
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.1"
  scope: [root, frontend]
  auto_invoke: "App Router / Server Actions"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – Next.js 16 App Router

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. The NestJS backend already exists in `backend/`. The target is 2 services behind one origin: `core` (public HTTP API under `/api`, modular monolith) and `telemetry` (`/api/v1/telemetry` and the `/ws` WebSocket). Today `core` is still the separate `backend/gateway` + `backend/auth` apps and `telemetry` has no code yet (see teamworkflow-nest).
Most files in this skill **do not exist yet**.

- Before importing any module or library, check it exists (Glob/Grep, `frontend/package.json`).
- If a file does not exist, CREATE it where this skill or teamworkflow-frontend says.
- NEVER import modules or libraries that do not exist.
- NEVER create files "just in case" — create them when a feature needs them.
- Mark pending work with `// TODO(<feature>):` and report it to the user.
- Detect `src/`, package manager and installed libraries as described in teamworkflow-frontend ("Detect before acting"). Paths below are relative to `frontend/` (prefix with `src/` if used).

---

## Critical Rules

- Server Components by default; `"use client"` only when required (see teamworkflow-react).
- The frontend NEVER accesses the database. All data goes through the public HTTP API (`core` under the global prefix `/api`, `telemetry` under `/api/v1/telemetry`; one origin) via `backendFetch`. NEVER call NATS or an internal service port directly.
- The backend DTOs are the source of truth: `types.ts` mirrors the response DTOs of `core` and `telemetry` (camelCase JSON, see teamworkflow-nest).
- From `app/` or other domains, import a domain ONLY through `@/domains/<domain>` (client-safe), `@/domains/<domain>/server` (server-only) or `@/domains/<domain>/actions`. No deep imports.
- Server Actions live in `domains/<domain>/actions.ts`; Zod schemas in `domains/<domain>/schemas.ts`.
- ALWAYS validate Server Action input with Zod on the server.
- `params` and `searchParams` are Promises — ALWAYS `await` them.
- `redirect()` and `notFound()` throw — NEVER call them inside `try/catch`.
- Use `proxy.ts`, NEVER `middleware.ts` (deprecated in Next.js 16).

---

## Where Next.js Things Go

Full structure and placement rules: teamworkflow-frontend. Next.js-specific files:

| What | Location | Create when |
|------|----------|-------------|
| Backend HTTP client | `shared/api/backend.ts` | FIRST, before any feature (see Foundation) |
| Env vars | `.env.local` (+ `.env.example` committed) | FIRST, with the backend client |
| Domain backend calls (private) | `domains/<domain>/api.ts` | First backend read/write of the domain |
| Domain server public API | `domains/<domain>/server.ts` | First time `app/` or another domain needs server data |
| Domain client-safe public API | `domains/<domain>/index.ts` | First time `app/` or another domain needs a type/component |
| Server Actions | `domains/<domain>/actions.ts` | First mutation in the domain |
| Zod schemas | `domains/<domain>/schemas.ts` | First validated input in the domain |
| Pages / layouts | `app/(teamworkflow)/<route>/page.tsx` | New app route |
| Auth pages | `app/(auth)/<route>/page.tsx` | When auth is implemented |
| Route Handlers | `app/api/<name>/route.ts` | Health checks, webhooks, BFF endpoints |
| Proxy | `proxy.ts` (next to `app/`) | First need for redirects/headers/auth guard |
| Next config | `next.config.ts` | exists (scaffold) — edit, never replace |

`server.ts` re-exports from `api.ts` and may also export async Server Components that fetch data themselves. `index.ts` NEVER exports anything server-only.

---

## Next.js 16 Notes

- Use `proxy.ts` for request-boundary logic. `middleware.ts` is deprecated.
- `proxy.ts` runs on the Node.js runtime and cannot be configured for Edge.
- Keep `proxy.ts` matchers narrow. Exclude `api`, `_next`, static files and images unless a route needs proxy logic.
- Route Handlers are for health checks, webhooks, BFF endpoints and server-only proxy calls. For UI mutations, prefer Server Actions.
- `fetch` is NOT cached by default. Cache explicitly with `"use cache"` (Cache Components).

---

## Foundation (create once, before the first feature)

Confirm with the user, then set up in this order.

### 1. Dependencies

```bash
cd frontend
<pm> install zod server-only   # <pm> = detected package manager (npm / pnpm / yarn)
```

### 2. Environment variables

```bash
# frontend/.env.local (NOT committed)
BACKEND_URL=http://localhost:3000/api   # core base URL (global prefix /api); telemetry is reached under /api/v1/telemetry on the same origin
```

```bash
# frontend/.env.example (committed, no real values)
BACKEND_URL=http://localhost:3000/api
```

Server-only variables MUST NOT use the `NEXT_PUBLIC_` prefix.

### 3. Backend client

```ts
// frontend/shared/api/backend.ts
import "server-only";

const BACKEND_URL = process.env.BACKEND_URL;

// Backend error shape (core and telemetry, teamworkflow-nest): { detail, code, errors? }
export type ApiError = {
  detail: string;
  code: string;
  errors?: { field: string; constraints: string[] }[];
};

export class BackendError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errors: ApiError["errors"] = undefined,
  ) {
    super(message);
  }
}

export async function backendFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BACKEND_URL) throw new Error("BACKEND_URL is not set");

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new BackendError(res.status, body?.code ?? "unknown_error", body?.detail ?? res.statusText, body?.errors);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

```ts
// ❌ NEVER: hardcoded URLs, direct fetch to the backend from pages/components, exported secrets
await fetch("http://localhost:3000/api/projects");
export const authToken = process.env.BACKEND_AUTH_TOKEN; // exported secret
```

---

## Implementing a Domain Feature (step by step)

When asked to implement a feature like "list projects" or "create a project":

1. **Backend contract.** Grep `backend/core/src/<module>/` (or `backend/telemetry/src/<module>/` for attendance resources) for the controller and DTOs of the resource, and read the route map in `backend/core/AGENTS.md` / `backend/telemetry/AGENTS.md`; until T6 the code is in `backend/gateway/src/<domain>/` and `backend/auth/src/` (if it does not exist yet, agree the contract with the backend first, see teamworkflow-nest). Note paths, methods and field names.
2. **Types** → `domains/<domain>/types.ts`, mirroring the backend response DTOs.
3. **Backend calls** → `domains/<domain>/api.ts`, using `backendFetch`.
4. **Server public API** → export what `app/` needs from `domains/<domain>/server.ts`.
5. **Validation** → `domains/<domain>/schemas.ts` (only if there is input to validate).
6. **Mutations** → `domains/<domain>/actions.ts`.
7. **UI** → `domains/<domain>/components/`, exported via `domains/<domain>/index.ts` if used outside the domain.
8. **Page** → `app/(teamworkflow)/<route>/page.tsx`, importing only public entry points.
9. **Report** the files created and any `TODO` left.

### Types

```ts
// frontend/domains/projects/types.ts
// Mirrors the backend response DTOs (to create) — keep field names identical to the API.
export type ProjectStatus = "planned" | "active" | "completed";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  teamId: string;
  status: ProjectStatus;
  createdAt: string;
};

// The owner is NOT part of the input: the backend takes it from the authenticated user.
export type CreateProjectInput = {
  name: string;
  description?: string;
  teamId: string;
};
```

> The NestJS backend returns camelCase JSON, ISO-8601 datetimes and `null` for empty optionals (teamworkflow-nest). Mirror whatever the DTO exposes.

### Backend calls (private)

> Collection endpoints of the backend return a paginated `PageDto<T>` (`items`, `total`, `page`, `pageSize`, see teamworkflow-nest). The `getProjects` example below returns `Project[]` for brevity; unwrap `items` or type the page when the endpoint exists.

```ts
// frontend/domains/projects/api.ts
import "server-only";
import { backendFetch, BackendError } from "@/shared/api/backend";
import type { Project, CreateProjectInput } from "./types";

export function getProjects() {
  return backendFetch<Project[]>("/projects");
}

export async function getProjectById(id: string): Promise<Project | null> {
  try {
    return await backendFetch<Project>(`/projects/${id}`);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return null;
    throw error;
  }
}

export function createProject(input: CreateProjectInput) {
  return backendFetch<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

### Public entry points

```ts
// frontend/domains/projects/server.ts
import "server-only";

export { getProjects, getProjectById } from "./api";
```

```ts
// frontend/domains/projects/index.ts — client-safe ONLY
export type { Project, ProjectStatus } from "./types";
export { ProjectsList } from "./components/ProjectsList";
```

> Export only what is consumed outside the domain. `createProject` from `api.ts` stays private: it is used by `actions.ts` inside the domain.

---

## Server Components (Default)

```tsx
// frontend/app/(teamworkflow)/projects/page.tsx
import { getProjects } from "@/domains/projects/server";
import { ProjectsList } from "@/domains/projects";

export default async function Page() {
  const projects = await getProjects();
  return <ProjectsList projects={projects} />;
}
```

### Dynamic params (Promise)

```tsx
// frontend/app/(teamworkflow)/projects/[id]/page.tsx
import { notFound } from "next/navigation";
import { getProjectById } from "@/domains/projects/server";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return <h1>Project {project.id}</h1>;
}
```

---

## Server Actions

Signature `(prevState, formData)` so they work with `useActionState` (see teamworkflow-react).
For object-input actions used with React Hook Form, see teamworkflow-frontend ("Forms").

```ts
// frontend/domains/projects/schemas.ts
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  teamId: z.uuid(),
});

export type CreateProjectValues = z.infer<typeof createProjectSchema>;
```

```ts
// frontend/domains/projects/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createProjectSchema } from "./schemas";
import { createProject } from "./api";

export type ProjectFormState = {
  success: boolean;
  message: string;
  fieldErrors?: Partial<Record<string, string[]>>;
} | null;

export async function submitProject(
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  // TODO(auth): once auth exists, call `await requireSession()` from "@/domains/auth/server".
  // Server Actions are public endpoints — they MUST check auth once it is implemented.

  const parsed = createProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid data",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  try {
    await createProject(parsed.data);
  } catch {
    return { success: false, message: "Could not create the project. Try again." };
  }

  // OUTSIDE try/catch — redirect throws
  revalidatePath("/projects");
  redirect("/projects");
}
```

- `"use server"` files may only export async functions (types are fine). Schemas and constants go in `schemas.ts`.
- Zod 4 syntax (`z.uuid()`, `z.flattenError`). If `package.json` has Zod 3, use `z.string().uuid()` and `parsed.error.flatten()`.

---

## Data Fetching & Streaming

```tsx
// frontend/app/(teamworkflow)/dashboard/page.tsx
import { Suspense } from "react";
import { getProjects, getRecentActivity } from "@/domains/projects/server";
import { getTasks } from "@/domains/tasks/server";
import { ProjectsSummary, RecentActivity } from "@/domains/projects";
import { TaskStats } from "@/domains/tasks";

export default async function Page() {
  // ✅ Start the slow request early, do NOT await it
  const recentActivityPromise = getRecentActivity();

  // ✅ Independent fetches in parallel
  const [projects, tasks] = await Promise.all([getProjects(), getTasks()]);

  return (
    <>
      <ProjectsSummary projects={projects} />
      <TaskStats tasks={tasks} />

      {/* ✅ Slow part streams in; RecentActivity reads the promise with use() */}
      <Suspense fallback={<p>Loading recent activity…</p>}>
        <RecentActivity recentActivityPromise={recentActivityPromise} />
      </Suspense>
    </>
  );
}
```

```tsx
// ❌ NEVER: sequential awaits for independent data
const projects = await getProjects();
const tasks = await getTasks();
```

> Pages compose components from several domains through their public APIs. A page is not a domain: do not create a `dashboard` domain just to group a page's components.

---

## Caching and Revalidation

`fetch` is NOT cached by default in Next.js 16. Revalidate after every mutation.

```ts
"use server";

import { revalidatePath, revalidateTag, updateTag } from "next/cache";

// Inside a mutation Server Action:
updateTag("tasks");            // Read-your-writes: the user sees the change immediately (Server Actions only)
revalidatePath("/dashboard");     // Invalidate a route

// Background refresh (stale-while-revalidate):
revalidateTag("tasks", "max"); // cacheLife profile argument is required in Next.js 16
```

### Cache Components (opt-in)

Do NOT enable until there is a concrete need to cache public data, and ask the user first.

```ts
// frontend/next.config.ts — edit the existing file, keep other options
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
```

```ts
// frontend/domains/tasks/api.ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { backendFetch } from "@/shared/api/backend";
import type { Task } from "./types";

// ✅ Public, non-user-specific data only
export async function getTaskCatalog() {
  "use cache";
  cacheLife("hours");
  cacheTag("tasks");
  return backendFetch<Task[]>("/tasks/catalog");
}
```

- NEVER cache auth, tenant-scoped or per-user data unless the function arguments isolate it.
- NEVER read `cookies()` / `headers()` inside a `"use cache"` scope. Read outside and pass values as arguments.

---

## Route Handlers (API)

```ts
// frontend/app/api/health/route.ts
export async function GET() {
  return Response.json({ status: "ok" });
}
```

### Webhooks (when implemented)

Create at `app/api/webhooks/<provider>/route.ts`:

- Read the raw body with `await request.text()` BEFORE parsing JSON.
- Verify the provider signature first. Verification helpers go in `shared/lib/webhooks.ts`.
- Forward the validated payload to the backend via `backendFetch`; business logic lives in the backend.
- Return `401` on invalid signature.

---

## Proxy (Replaces Middleware)

Create `proxy.ts` (next to `app/`) only on the first concrete need: redirects, headers or the auth guard.

- Runs on Node.js (no Edge).
- Only **optimistic** checks (cookie present or not). Real authorization lives in Server Actions, data fetchers and the backend (the guard of `core`/`telemetry`).

```ts
// frontend/proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // TODO(auth): use the cookie name set by the auth implementation.
  const session = request.cookies.get("session");

  if (!session && request.nextUrl.pathname.startsWith("/dashboard")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

---

## Auth (NOT IMPLEMENTED YET)

When the user decides to implement auth:

- Session helpers → `domains/auth/session.ts` (`import "server-only"`), with at least `getSession()` and `requireSession()`.
- Expose them via `domains/auth/server.ts` so other domains import `@/domains/auth/server`.
- Login/logout actions → `domains/auth/actions.ts`.
- Pages → `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`.
- Then Grep for `TODO(auth)` and resolve every occurrence.

Until then, do NOT invent auth helpers or import them.

---

## Metadata

```tsx
// Static — in layout.tsx or page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TeamWorkFlow",
  description: "Team workflow management",
};
```

```tsx
// Dynamic — params is a Promise
import type { Metadata } from "next";
import { getProjectById } from "@/domains/projects/server";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const project = await getProjectById(id);
  return { title: project ? `TeamWorkFlow | Project ${project.id}` : "TeamWorkFlow" };
}
```

---

## `server-only`

Add `import "server-only";` at the top of every module that:

- Calls the backend (`shared/api/*`, `domains/*/api.ts`, `domains/*/server.ts`)
- Reads non-`NEXT_PUBLIC_` env vars
- Contains auth/session logic

If a Client Component imports one of these, the build fails instead of leaking secrets.

---

## Checklist

- [ ] Every imported module and library exists (or was created/installed in this change)
- [ ] No deep imports: `app/` and other domains use `@/domains/x`, `@/domains/x/server`, `@/domains/x/actions`
- [ ] `index.ts` exports nothing server-only
- [ ] Types mirror the backend DTOs
- [ ] Backend calls only through `backendFetch` in `domains/*/api.ts`
- [ ] Schemas in `schemas.ts`; Server Actions validate with Zod
- [ ] `params` / `searchParams` awaited
- [ ] `redirect()` / `notFound()` outside `try/catch`
- [ ] `server-only` in every server module
- [ ] Independent fetches in `Promise.all`; slow parts in `<Suspense>`
- [ ] Revalidation after every mutation
- [ ] Pending work marked with `// TODO(<feature>):` and reported