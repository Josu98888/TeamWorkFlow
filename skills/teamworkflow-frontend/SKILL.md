---
name: teamworkflow-frontend
description: >
  TeamWorkFlow frontend architecture and conventions: domain structure, public APIs between domains,
  shared vs domain placement, no-duplication rules, shadcn/ui design system policy, forms, tooling.
  Trigger: When creating, moving or reviewing files inside frontend/, adding UI components,
  installing frontend libraries, or deciding where code should live.
  This skill is the source of truth for frontend structure and imports. Also use:
  teamworkflow-nextjs (App Router, Server Actions, data fetching), teamworkflow-react (React 19 rules),
  teamworkflow-tailwind (styling and tokens), teamworkflow-typescript (types), teamworkflow-zod (validation),
  teamworkflow-zustand (client state stores), teamworkflow-test-ui (Playwright E2E tests).
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.3"
  scope: [root, frontend]
  auto_invoke:
    - "Creating/modifying TeamWorkFlow UI components"
    - "Reviewing TeamWorkFlow frontend code"
    - "Working on TeamWorkFlow frontend architecture (domains/actions/store/types)"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – Frontend Architecture

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. The NestJS backend already exists in `backend/` (`core`, a modular monolith with the public HTTP API, plus `telemetry` for attendance, behind one origin; `telemetry` has no code yet; see teamworkflow-nest).
Most folders, libraries and tooling in this skill **do not exist yet**.

- Before importing any module or library, check it exists: Glob/Grep for files, `frontend/package.json` for dependencies.
- If a file does not exist, CREATE it where this skill says.
- If a library is not installed, do NOT import it. Tell the user which library is needed and why, and install it only after confirmation (see "Libraries").
- NEVER create folders, stores or abstractions "just in case".
- Mark pending work with `// TODO(<feature>):` and report it to the user.
- If an example in another TeamWorkFlow skill contradicts this skill on structure or imports, THIS skill wins.

### Detect before acting

| Check | Where | Why |
|-------|-------|-----|
| `src/` or not | `frontend/tsconfig.json` → `"@/*"` | Prefix all paths with `src/` if `"@/*": ["./src/*"]` |
| Package manager | lockfile in `frontend/` | `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn |
| Installed libs & versions | `frontend/package.json` | Never assume a library or version |
| Available scripts | `package.json` → `scripts` | Never run a script that is not defined |
| Global CSS / tokens | `app/globals.css` | Single source of truth for colors |

---

## Related Skills (who owns what)

Each rule lives in ONE skill. Load the owner when working on its topic.

| Topic | Owner skill |
|-------|-------------|
| Folder structure, placement, imports, design-system policy, no duplication | **teamworkflow-frontend** (this skill) |
| App Router, Server Actions, data fetching, caching, proxy, metadata | teamworkflow-nextjs |
| React 19 components, hooks, Compiler, `use()`, forms with `useActionState` | teamworkflow-react |
| Tailwind syntax, tokens, `cn()`, `cva`, styling decisions | teamworkflow-tailwind |
| Types, mirroring backend DTOs, unions, exhaustiveness | teamworkflow-typescript |
| Zod schemas, FormData/searchParams validation, error formatting | teamworkflow-zod |
| Zustand stores, selectors, persist | teamworkflow-zustand |
| E2E tests (Playwright), Page Objects, test data, test docs | teamworkflow-test-ui |

---

## Critical Rules

- Business logic lives in `domains/<domain>/`; only agnostic code goes to `shared/`.
- Other domains and `app/` import a domain ONLY through its public entry points (`index.ts`, `server.ts`, `actions.ts`). No deep imports.
- Search before writing: reuse existing components, hooks, helpers, types, schemas, labels and constants. No duplicated code.
- UI built with shadcn/ui + Tailwind. Colors only from semantic tokens in `app/globals.css`.
- The frontend NEVER accesses the database — only the public HTTP API of the NestJS backend (`core` under `/api`, `telemetry` under `/api/v1/telemetry`; one origin) via `backendFetch` (teamworkflow-nextjs).
- Server-side validation is mandatory, even if the client validates too.

---

## Project Structure (target)

Create each part only when a feature needs it.

```text
frontend/
├── app/                          # Routing layer ONLY: layouts, pages, route handlers
│   ├── globals.css               # exists (scaffold) — design tokens, single source of colors
│   ├── layout.tsx                # exists (scaffold)
│   ├── page.tsx                  # exists (scaffold)
│   ├── (auth)/                   # login, signup (when auth exists)
│   ├── (teamworkflow)/              # main app routes
│   └── api/                      # route handlers
├── domains/                      # Vertical slices by business context
│   └── <domain>/                 # e.g. projects, tasks, teams, users
│       ├── index.ts              # Public API — client-safe
│       ├── server.ts             # Public API — server-only
│       ├── actions.ts            # Server Actions ("use server")
│       ├── api.ts                # Backend calls (server-only, private)
│       ├── types.ts              # Types mirroring NestJS backend DTOs
│       ├── schemas.ts            # Zod schemas (shared client/server)
│       ├── labels.ts             # Display maps for this domain
│       ├── constants.ts          # Cache tags, paths, repeated literals
│       ├── store.ts              # Zustand store (only if needed)
│       ├── context/              # Domain contexts / store providers
│       ├── hooks/                # Domain client hooks
│       └── components/           # Domain UI
├── shared/                       # Agnostic, business-free code
│   ├── api/backend.ts            # Backend client (server-only)
│   ├── components/
│   │   ├── shadcn/               # shadcn/ui primitives (generated by CLI)
│   │   ├── charts/               # Chart helpers (chart-colors.ts…)
│   │   └── <Name>.tsx            # Agnostic composed components
│   ├── hooks/                    # Generic hooks (useDebounce…)
│   ├── lib/
│   │   ├── utils.ts              # cn() and generic helpers
│   │   ├── constants.ts          # Agnostic repeated literals
│   │   └── schemas.ts            # Agnostic Zod schemas (pagination…)
│   ├── providers/                # Global client providers
│   └── store.ts                  # Truly global client state (only if needed)
├── tests/                        # Playwright E2E — internal layout: teamworkflow-test-ui
├── playwright.config.ts          # Playwright config (when E2E is set up)
└── proxy.ts
```

---

## Domain Encapsulation (REQUIRED)

Each domain exposes up to three public entry points. Everything else is private.

| Entry point | Contains | Who imports it |
|-------------|----------|----------------|
| `index.ts` | Types, client-safe components, providers/hooks, labels, constants, pure helpers, schemas | Any file (client or server) |
| `server.ts` | Re-exports of `api.ts` and async Server Components that fetch data (starts with `import "server-only"`) | Server Components, Route Handlers, other domains' server code |
| `actions.ts` | Server Actions | Client and Server Components |

```ts
// frontend/domains/tasks/index.ts — client-safe ONLY
export type { Task, TaskStatus } from "./types";
export { TaskCard } from "./components/TaskCard";
export { taskStatusLabel } from "./labels";
```

```ts
// frontend/domains/tasks/server.ts
import "server-only";

export { getTasks, getTaskById } from "./api";
```

```tsx
// ✅ From app/ or another domain
import { getTasks } from "@/domains/tasks/server";
import { TaskCard, type Task } from "@/domains/tasks";
import { submitProject } from "@/domains/projects/actions";

// ✅ Inside the same domain: relative imports
import { TaskCard } from "./components/TaskCard";

// ❌ NEVER: deep imports from outside the domain
import { TaskCard } from "@/domains/tasks/components/TaskCard";
import { getTasks } from "@/domains/tasks/api";

// ❌ NEVER: re-export api.ts or server-only code from index.ts (breaks Client Components)
export { getTasks } from "./api";
```

- Create `index.ts` / `server.ts` the first time something in the domain is consumed from outside it.
- Add exports as they are needed; do not pre-export everything.
- Avoid circular dependencies between domains. If two domains need each other, extract the agnostic part to `shared/` or ask the user.

---

## Decision Trees

### Where does this code go?

```text
Business concept (project, task, client…)? → domains/<domain>/   (even if used in 2+ places)
Agnostic (dates, strings, generic UI)?      → shared/
shadcn primitive?                           → shared/components/shadcn/   (via CLI only)
Agnostic composed UI (no business data)?    → shared/components/
Page / layout / routing?                    → app/(teamworkflow)/… or app/(auth)/…
Backend call?                               → domains/<domain>/api.ts → exposed via server.ts
Mutation?                                   → domains/<domain>/actions.ts
Zod schema?                                 → domains/<domain>/schemas.ts (agnostic: shared/lib/schemas.ts)
Display labels / maps?                      → domains/<domain>/labels.ts
Literal used in 2+ places?                  → domains/<domain>/constants.ts (or shared/lib/constants.ts)
Client state?                               → see "Client State" below
E2E test, Page Object, test helper?         → tests/ (teamworkflow-test-ui)
```

### Client or Server Component?

```text
Needs state, effects, handlers, browser APIs? → "use client" (smallest leaf)
Otherwise                                     → Server Component (no directive)
```

### Styling

Styling decisions (className vs `cn()` vs `cva` vs `style`): teamworkflow-tailwind.

---

## No Duplication (REQUIRED)

### Search before writing

Before creating a component, hook, helper, type, schema, label map, store, constant or Page Object, search for an existing one (Glob/Grep by name AND by purpose). Reuse it or extend it.

### One source per thing

| Thing | Single source | Details |
|-------|---------------|---------|
| Colors | `app/globals.css` tokens | teamworkflow-tailwind |
| Visual variants / repeated class combos | `cva` / extracted component | teamworkflow-tailwind |
| Backend data types | `domains/<domain>/types.ts` (derive the rest) | teamworkflow-typescript |
| Enum values | `as const` arrays in `types.ts` | teamworkflow-typescript |
| Input validation | `schemas.ts`, same schema client + server | teamworkflow-zod |
| Business mappings (status → label/variant) | One place (`labels.ts` or one component) | below |
| Repeated literals | `constants.ts` | below |
| E2E locators per page | One Page Object per page | teamworkflow-test-ui |

### Centralize repeated literals

Strings used in more than one place (cache tags, route paths, query param names) go in the domain's `constants.ts`, or `shared/lib/constants.ts` if agnostic:

```ts
// frontend/domains/tasks/constants.ts
export const TASKS_CACHE_TAG = "tasks";
export const TASKS_PATH = "/tasks";
```

```ts
// ✅
cacheTag(TASKS_CACHE_TAG);
updateTag(TASKS_CACHE_TAG);

// ❌ Same literal typed in several files
cacheTag("tasks");
updateTag("task"); // typo, silently breaks revalidation
```

### Single place for each mapping

Each business mapping (status → label, status → badge variant, role → permissions) exists in ONE place. Components render the mapped result (`<ProjectStatusBadge status={…} />`) instead of repeating the mapping.

### When you find duplication

- Logic or UI duplicated within your change → extract it before finishing, to the place the Scope Rule dictates (domain or `shared/`).
- Pre-existing duplication outside your change → do not refactor silently. Report it to the user with the locations and a suggested extraction.

### Don't over-abstract

Extract on the second real use, not speculatively. One usage stays inline, consistent with "never create things just in case".

---

## Design System Policy (shadcn/ui)

Tailwind syntax, tokens, `cn()` and `cva` patterns: teamworkflow-tailwind. This section defines WHICH components to use and WHEN the design system may change.

### Setup (when the first UI component is needed)

If `frontend/components.json` does not exist, ask the user before running `shadcn init`. After init, configure the aliases so primitives land in `shared/`:

```json
{
  "tailwind": {
    "css": "app/globals.css"
  },
  "aliases": {
    "components": "@/shared/components",
    "ui": "@/shared/components/shadcn",
    "utils": "@/shared/lib/utils",
    "lib": "@/shared/lib",
    "hooks": "@/shared/hooks"
  }
}
```

Add primitives one at a time when needed:

```bash
npx shadcn@latest add button
```

> Use the project's package manager runner (`npx`, `pnpm dlx`, `yarn dlx`).

### Rules

- **Reuse first.** Before building UI, search `shared/components/shadcn/`, `shared/components/` and existing usages. Do NOT create a custom modal, select, button or primitive if one exists or can be added with the shadcn CLI.
- **Modals** → shadcn `dialog` (or `alert-dialog` for confirmations, `sheet` for side panels).
- **Selects** → shadcn `select`.
- **Variants, not call-site styling.** Drive appearance with `variant`, `size` and similar props. NEVER add visual `className` (color, opacity, hover/focus/disabled, decorative spacing) to shared controls at the call site. Layout classes (`w-full`, grid/flex placement, margins between siblings) are allowed.
- **Colors** → semantic tokens only (teamworkflow-tailwind, "Single Source of Truth").
- **No fitting token or variant?** First check whether an existing one is equivalent. If not, STOP and ask the user. A new token or variant is a design-system change, never a call-site decision.
- **shadcn folder is for primitives only.** NEVER put domain logic or business components in `shared/components/shadcn/`. Edit those files only to add approved variants.
- **Accessible names on every control.** Labels, `aria-label` on icon buttons. This is required for accessibility AND for role-based E2E selectors (teamworkflow-test-ui).

```tsx
// ✅ Semantic variant
<Button variant="destructive" size="sm">Delete</Button>

// ❌ NEVER: call-site visual overrides / raw colors
<Button className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
```

### Review flags

When reviewing frontend code, flag: custom primitives duplicating shadcn, visual `className` on shared controls, raw color utilities or hex, duplicated or near-duplicate tokens, new tokens/variants added outside the shared component API, repeated class combinations, duplicated types/mappings/literals/schemas, controls without accessible names, and deep imports between domains.

---

## Charts (when a chart library is installed)

For library props that do not accept `className`, use CSS variables through a single constant. Create it when the first chart is needed.

```ts
// frontend/shared/components/charts/chart-colors.ts
// References tokens from app/globals.css — never copy color values here
export const CHART_COLORS = {
  primary: "var(--chart-1)",
  secondary: "var(--chart-2)",
  text: "var(--muted-foreground)",
  gridLine: "var(--border)",
} as const;
```

```tsx
// ✅ var() only in library props
<XAxis tick={{ fill: CHART_COLORS.text }} />
<CartesianGrid stroke={CHART_COLORS.gridLine} />

// ❌ NEVER var() inside className, NEVER color values in JS
<div className="bg-[var(--chart-1)]" />
const CHART_COLORS = { primary: "#2563eb" };
```

> Verify the token names exist in `app/globals.css` before using them.

---

## Forms

Schema rules (placement, FormData coercion, error formatting): teamworkflow-zod.

### Default: native form + Server Action + `useActionState`

Use for most forms (simple fields, submit-and-save). Patterns in teamworkflow-react ("Forms") and teamworkflow-nextjs ("Server Actions").

### Complex forms: React Hook Form (only if installed)

Use React Hook Form only when needed: many fields, dynamic field arrays, multi-step, or live per-field validation. Requires `react-hook-form` and `@hookform/resolvers` (v5+ for Zod 4). Ask before installing.

```ts
// frontend/domains/tasks/schemas.ts
import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, { error: "Title is required" }).max(100),
  description: z.string().trim().min(1, { error: "Description is required" }).max(100),
  estimateHours: z.number().int().min(0),
});

export type CreateTaskValues = z.infer<typeof createTaskSchema>;
```

```ts
// frontend/domains/tasks/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createTaskSchema } from "./schemas";
import { createTask as createTaskInBackend } from "./api";
import { TASKS_PATH } from "./constants";

export type CreateTaskResult =
  | { success: true }
  | { success: false; message: string };

// Receives a plain object from RHF — still validated on the server
export async function createTask(input: unknown): Promise<CreateTaskResult> {
  // TODO(auth): call requireSession() from "@/domains/auth/server" once auth exists.
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid data" };

  try {
    await createTaskInBackend(parsed.data);
  } catch {
    return { success: false, message: "Could not create the task. Try again." };
  }

  revalidatePath(TASKS_PATH);
  return { success: true };
}
```

```tsx
// frontend/domains/tasks/components/TaskForm.tsx
"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createTaskSchema, type CreateTaskValues } from "../schemas";
import { createTask } from "../actions";

export function TaskForm() {
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateTaskValues>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { title: "", description: "", estimateHours: 1 },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createTask(values);
      if (!result.success) form.setError("root", { message: result.message });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <input {...form.register("title")} aria-invalid={!!form.formState.errors.title} />
      {form.formState.errors.title && <p role="alert">{form.formState.errors.title.message}</p>}

      {/* …other fields… */}

      {form.formState.errors.root && <p role="alert">{form.formState.errors.root.message}</p>}
      <button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
```

> When shadcn's `form` / `field` components are installed, use them instead of raw `<input>` / `<p>`.
> If the schema uses `coerce` / `transform` / `default`, type the form with `z.input` / `z.output` (teamworkflow-zod).

---

## Client State

Use the FIRST option that fits:

```text
1. Data from the backend?                     → Server Component props (NOT client state)
2. Shareable/bookmarkable (filters, page)?    → URL searchParams
3. Used by one component (or parent+child)?   → useState / props
4. Shared by a small subtree, rarely changes? → React context
5. Shared by distant components, changes often,
   or must persist across navigations?        → Zustand store
```

Store placement, patterns and rules: teamworkflow-zustand.

---

## Component API Rules

### Batch vs Instant: discriminated unions (REQUIRED)

When a component supports mutually exclusive modes, model them as a discriminated union, never as independent optional props. General rule: teamworkflow-typescript ("Coupled Props").

```ts
// ❌ NEVER: independent optionals allow invalid half-states
type FilterProps = {
  onBatchApply?: (values: string[]) => void;
  onInstantChange?: (value: string) => void;
  isBatchMode?: boolean;
};

// ✅ ALWAYS: one valid shape per mode
type BatchProps = {
  mode: "batch";
  onApply: (values: string[]) => void;
  onCancel: () => void;
  onChange?: never;
};

type InstantProps = {
  mode: "instant";
  onChange: (value: string) => void;
  onApply?: never;
  onCancel?: never;
};

type FilterProps = BatchProps | InstantProps;
```

### Derived state (REQUIRED)

Never mirror props or `searchParams` into state with an effect. Derive during render.

```tsx
// ❌ NEVER
const [localFilter, setLocalFilter] = useState(filter);
useEffect(() => setLocalFilter(filter), [filter]);

// ✅
const localFilter = filter;
```

If local state is genuinely needed (buffered edits, optimistic UI), justify it with a comment:

```tsx
// Local state needed: edits are buffered until "Apply" is clicked
const [pending, setPending] = useState(initialValues);
```

---

## Labels & Display Maps

### Reuse before creating (REQUIRED)

Before adding a label map, formatter or status string, search:

- `domains/<domain>/labels.ts` — business labels (statuses, roles, categories)
- `shared/lib/` — agnostic formatters (dates, currency, numbers)

If none exists, create it in the right place and export it through the domain's `index.ts`. NEVER duplicate a map that already exists.

### Strict key typing (REQUIRED)

```ts
// frontend/domains/projects/labels.ts
import type { ProjectStatus } from "./types";

// ❌ Loose — typos compile silently
const LOOSE: Record<string, string> = { actve: "Active" };

// ✅ Union key — missing or misspelled keys are compile errors
export const PROJECT_STATUS_LABELS = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
} as const satisfies Record<ProjectStatus, string>;

export function projectStatusLabel(status: ProjectStatus) {
  return PROJECT_STATUS_LABELS[status];
}
```

`ProjectStatus` is derived from the `as const` array in `types.ts`, which mirrors the backend enum (teamworkflow-typescript).

---

## Libraries

Planned stack — install each ONLY when the first feature needs it, after asking the user:

| Library | Purpose | Install when | Skill |
|---------|---------|--------------|-------|
| `zod` | Validation | First Server Action (foundation) | teamworkflow-zod |
| `server-only` | Server module guard | First backend call (foundation) | teamworkflow-nextjs |
| shadcn/ui (CLI) | UI primitives, `cn()`, `cva` | First UI component | teamworkflow-tailwind |
| `react-hook-form` + `@hookform/resolvers` | Complex forms | First complex form | this skill ("Forms") |
| `zustand` | Shared client state | First real need (see "Client State") | teamworkflow-zustand |
| Auth library | Authentication | When auth is designed | teamworkflow-nextjs ("Auth") |
| Chart library | Charts | First chart | this skill ("Charts") |
| `@playwright/test` | E2E tests | When E2E testing starts | teamworkflow-test-ui |

Always use the versions resolved in `package.json`; never hardcode versions from a skill.

---

## Commands

Use the detected package manager and ONLY scripts defined in `package.json`. The scaffold usually has `dev`, `build`, `start` and `lint`.

```bash
cd frontend && <pm> install
cd frontend && <pm> run dev
cd frontend && <pm> run lint
cd frontend && <pm> run build
```

Type checking works even without a script:

```bash
cd frontend && npx tsc --noEmit
```

Recommended scripts to add when tooling is set up (ask first):

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint:fix": "eslint . --fix",
    "healthcheck": "<pm> run typecheck && <pm> run lint"
  }
}
```

E2E setup, scripts and commands: teamworkflow-test-ui.

---

## QA Checklist Before Commit

- [ ] Type check passes (`typecheck` script or `npx tsc --noEmit`)
- [ ] Lint passes
- [ ] Relevant E2E tests pass and their `.md` docs are in sync (once Playwright is set up — teamworkflow-test-ui)
- [ ] Every imported module and library exists
- [ ] Files placed per "Decision Trees"; no deep imports between domains
- [ ] `index.ts` exports nothing server-only
- [ ] Searched for existing components/helpers/types/schemas/stores before creating new ones
- [ ] One source per thing (see "No Duplication"); repeated literals in `constants.ts`
- [ ] No duplicated logic, UI, mappings or class combinations introduced
- [ ] Client state follows the "Client State" order
- [ ] All UI states handled: loading, error, empty
- [ ] No secrets in code (use `.env.local`; no `NEXT_PUBLIC_` for secrets)
- [ ] User-facing errors sanitized (no stack traces or backend messages)
- [ ] Server-side validation present
- [ ] shadcn + semantic tokens only; no call-site visual overrides
- [ ] Accessibility: keyboard navigation, accessible names on controls, `aria-*`, `role="alert"` on errors
- [ ] Responsive layout where applicable

## Pre-Re-Review Checklist

Before requesting re-review on a PR:

- [ ] Every unresolved thread is either fixed or answered with a rationale
- [ ] Agreed changes are committed and the reply mentions the commit hash
- [ ] Disagreements are explained with clear reasoning — no silently open threads
- [ ] Re-request review only when all threads are clean