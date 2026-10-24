---
name: teamworkflow-react
description: >
  React 19 patterns with React Compiler for TeamWorkFlow.
  Trigger: When writing or editing React components/hooks in .tsx/.ts (React Compiler rules,
  Server vs Client Components, use(), useActionState, useOptimistic, context, refs as props),
  or when deciding where a new hook, context or provider should live.
  Structure, imports and design-system rules come from teamworkflow-frontend (source of truth).
  For App Router, Server Actions and data fetching, also use teamworkflow-nextjs.
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.1"
  scope: [root, frontend]
  auto_invoke: "Writing React components"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – React 19 Patterns

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. Most components, hooks and providers referenced here **do not exist yet**.

- Before importing any module or library, check it exists (Glob/Grep, `frontend/package.json`).
- If a file does not exist, CREATE it where this skill or teamworkflow-frontend says.
- NEVER import modules or libraries that do not exist.
- NEVER create components, hooks or providers "just in case".
- Examples use plain HTML elements (`<button>`, `<input>`) for brevity. Real UI uses shadcn/ui primitives and semantic tokens per teamworkflow-frontend.

---

## Critical Rules

- NEVER use `useMemo`, `useCallback` or `memo` — React Compiler handles it.
- ALWAYS use named imports from `"react"` (`import type` for types).
- Server Components by default; `"use client"` only when required, on the smallest leaf.
- NEVER fetch backend data with `useEffect` — fetch in Server Components (see teamworkflow-nextjs).
- NEVER use `forwardRef` — `ref` is a regular prop in React 19.
- ALWAYS type props, state and action results. No `any`.
- Named exports for components (`export function X`), except Next.js special files (`page.tsx`, `layout.tsx`, `error.tsx`…), which require `export default`.
- NEVER mutate props or state (`.sort()`, `.push()`, `.reverse()`, direct assignment).
- Imports across domains or from `app/` go through public entry points only (`@/domains/x`, `@/domains/x/server`, `@/domains/x/actions`). Inside a domain, use relative imports.

---

## Where React Things Go

Full structure and placement rules: teamworkflow-frontend. Paths are relative to `frontend/` (prefix with `src/` if used).

| What | Location | Create when |
|------|----------|-------------|
| Domain component | `domains/<domain>/components/<Name>.tsx` | UI tied to a business concept |
| Agnostic composed component | `shared/components/<Name>.tsx` | Generic UI with NO business logic |
| Primitive (button, input, dialog…) | `shared/components/shadcn/` via shadcn CLI | Never hand-written |
| Domain hook | `domains/<domain>/hooks/use<Name>.ts` | Client logic reused within a domain |
| Agnostic hook | `shared/hooks/use<Name>.ts` | Generic logic (useDebounce…) |
| Domain context | `domains/<domain>/context/<Name>Context.tsx` | State shared across a domain's client tree |
| Global provider | `shared/providers/<Name>Provider.tsx` | App-wide client state |
| Providers mount | `app/layout.tsx` | When the first global provider is created |
| Route-only component | `app/<route>/_components/<Name>.tsx` | Used by that single route only |

- Business components stay in their domain even if used by several pages or domains; export them via the domain's `index.ts`.
- A hook used by only one component stays in that component's file until it is reused.
- Naming: components `PascalCase.tsx`; hooks `useCamelCase.ts`.

---

## React Compiler Setup (check once)

The "no manual memoization" rule assumes the React Compiler is enabled. Check `frontend/next.config.ts`:

```ts
// frontend/next.config.ts — edit the existing file, keep other options
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default nextConfig;
```

If `reactCompiler` is missing, tell the user. Enabling it requires (ask first):

```bash
cd frontend
<pm> install -D babel-plugin-react-compiler   # <pm> = detected package manager
```

Even without the compiler, do NOT add manual memoization unless the user asks.

---

## No Manual Memoization (REQUIRED)

```tsx
// frontend/domains/tasks/components/TaskList.tsx
import type { Task } from "../types";

type Props = {
  tasks: Task[];
  onSelect: (id: string) => void;
};

// ✅ React Compiler optimizes automatically
export function TaskList({ tasks, onSelect }: Props) {
  const available = tasks
    .filter((t) => !t.isArchived)
    .toSorted((a, b) => a.title.localeCompare(b.title));

  return (
    <ul>
      {available.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onSelect(t.id)}>
            {t.title}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// ❌ NEVER: manual memoization
const available = useMemo(() => tasks.filter((t) => !t.isArchived), [tasks]);
const handleSelect = useCallback((id: string) => onSelect(id), [onSelect]);
export const TaskList = memo(function TaskList() { /* ... */ });

// ❌ NEVER: mutating arrays from props
tasks.sort((a, b) => a.title.localeCompare(b.title));
```

> Field names (`isArchived`, etc.) must match `domains/<domain>/types.ts`, which mirrors the NestJS DTOs (teamworkflow-nest).

---

## Imports (REQUIRED)

```tsx
// ✅ Named imports, type-only imports for types
import { useState, useEffect, useRef } from "react";
import type { ReactNode, ComponentProps } from "react";
```

```tsx
// ❌ NEVER
import React from "react";
import * as React from "react";
React.useState(); // or React.ReactNode
```

---

## Server vs Client Components

### Server Component (default — no directive)

```tsx
// frontend/app/(teamworkflow)/tasks/page.tsx
import { getTasks } from "@/domains/tasks/server";
import { TaskBrowser } from "@/domains/tasks";

export default async function Page() {
  const tasks = await getTasks();
  return <TaskBrowser tasks={tasks} />;
}
```

### Client Component (only when needed)

```tsx
// frontend/domains/tasks/components/TaskBrowser.tsx
"use client";

import { useState } from "react";
import type { Task } from "../types";
import { TaskList } from "./TaskList";

export function TaskBrowser({ tasks }: { tasks: Task[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <section>
      <TaskList tasks={tasks} onSelect={setSelectedId} />
      {selectedId && <p>Selected: {selectedId}</p>}
    </section>
  );
}
```

```ts
// frontend/domains/tasks/index.ts — add the export when app/ needs it
export { TaskBrowser } from "./components/TaskBrowser";
```

### When to use `"use client"`

- State or effect hooks: `useState`, `useReducer`, `useEffect`, `useRef`, `useActionState`, `useOptimistic`
- Reading context with `useContext` or `use(Context)`
- Event handlers: `onClick`, `onChange`, `onSubmit`, etc.
- Browser APIs: `window`, `document`, `localStorage`

### Boundary rules

- Put `"use client"` on the smallest interactive leaf, not on pages or layouts.
- Props from Server to Client Components MUST be serializable (plain objects, arrays, strings, numbers, Dates, Promises). Functions are NOT allowed, except Server Actions.
- Server Components can be passed as `children` to Client Components to keep them on the server.
- NEVER import server-only modules (`@/domains/x/server`, `domains/*/api.ts`, `shared/api/*`) from a Client Component.

```tsx
// ✅ Server content inside a client wrapper via children
<ClientTabs>
  <ServerRenderedStats />
</ClientTabs>
```

---

## `useEffect` — only for external systems

Use effects only to sync with things outside React: browser APIs, subscriptions, timers, third-party widgets.

```tsx
// ❌ NEVER: fetching backend data in an effect
useEffect(() => {
  fetch("/api/tasks").then((r) => r.json()).then(setTasks);
}, []);

// ❌ NEVER: deriving or mirroring state in an effect
useEffect(() => {
  setFullName(`${first} ${last}`);
}, [first, last]);

// ✅ Derive during render
const fullName = `${first} ${last}`;
```

If local state is genuinely needed (buffered edits, optimistic UI), justify it with a comment (see teamworkflow-frontend, "Derived state").

---

## `use()` Hook

### Reading a promise (requires `<Suspense>`)

```tsx
// frontend/app/(teamworkflow)/projects/[id]/page.tsx
import { Suspense } from "react";
import { getProjectComments } from "@/domains/projects/server";
import { ProjectComments } from "@/domains/projects";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const commentsPromise = getProjectComments(id); // do NOT await

  return (
    <Suspense fallback={<p>Loading comments…</p>}>
      <ProjectComments commentsPromise={commentsPromise} />
    </Suspense>
  );
}
```

```tsx
// frontend/domains/projects/components/ProjectComments.tsx
"use client";

import { use } from "react";
import type { ProjectComment } from "../types";

export function ProjectComments({ commentsPromise }: { commentsPromise: Promise<ProjectComment[]> }) {
  const comments = use(commentsPromise);

  if (comments.length === 0) return <p>No comments yet.</p>;

  return (
    <ul>
      {comments.map((c) => (
        <li key={c.id}>{c.text}</li>
      ))}
    </ul>
  );
}
```

> ❌ NEVER create the promise inside a Client Component render — it is recreated on every render.

### Reading context conditionally

```tsx
// frontend/shared/components/DensityText.tsx
"use client";

import { use } from "react";
import type { ReactNode } from "react";
import { DensityContext } from "@/shared/providers/DensityProvider";

export function DensityText({ adaptive, children }: { adaptive: boolean; children: ReactNode }) {
  if (adaptive) {
    const density = use(DensityContext); // ✅ allowed inside conditions, unlike useContext
    return <p className={density === "compact" ? "text-sm" : "text-base"}>{children}</p>;
  }
  return <p>{children}</p>;
}
```

---

## Context & Providers

Create a provider only when client state must be shared across distant components. Prefer, in order: props → URL state (`searchParams`) → local state → context → store (see teamworkflow-frontend, "Client State").

```tsx
// frontend/shared/providers/DensityProvider.tsx
"use client";

import { createContext, useState } from "react";
import type { ReactNode } from "react";

export type Density = "compact" | "comfortable";

export const DensityContext = createContext<Density>("comfortable");

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density] = useState<Density>("comfortable");

  // ✅ React 19: render the context directly, no `.Provider`
  return <DensityContext value={density}>{children}</DensityContext>;
}
```

```tsx
// frontend/app/layout.tsx — mount global providers here
import type { ReactNode } from "react";
import { DensityProvider } from "@/shared/providers/DensityProvider";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <DensityProvider>{children}</DensityProvider>
      </body>
    </html>
  );
}
```

> When creating the first provider, EDIT the existing scaffold `app/layout.tsx` — do not replace it. Keep its fonts, metadata, `lang` and classes.
> Theme (light/dark) is handled by the design system setup in teamworkflow-frontend, not by a custom context with colors.

---

## Forms: Actions & `useActionState`

Default pattern for forms. Server Actions and schemas are defined per teamworkflow-nextjs. For complex forms (React Hook Form), see teamworkflow-frontend ("Forms").

```tsx
// frontend/domains/projects/components/ProjectForm.tsx
"use client";

import { useActionState } from "react";
import { submitProject, type ProjectFormState } from "../actions";

// The form lives inside a team page, so the team is known; the owner is NOT sent:
// the backend takes it from the authenticated user (never trust an owner id from the client).
type Props = { teamId: string };

export function ProjectForm({ teamId }: Props) {
  // [state, formAction, isPending]
  const [state, formAction, isPending] = useActionState<ProjectFormState, FormData>(
    submitProject,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="teamId" value={teamId} />

      <label htmlFor="project-name">Name</label>
      <input id="project-name" name="name" required maxLength={100} />
      {state?.fieldErrors?.name && <p role="alert">{state.fieldErrors.name[0]}</p>}

      <label htmlFor="project-description">Description</label>
      <textarea id="project-description" name="description" maxLength={500} />
      {state?.fieldErrors?.description && (
        <p role="alert">{state.fieldErrors.description[0]}</p>
      )}

      <button type="submit" disabled={isPending}>
        {isPending ? "Saving project…" : "Save project"}
      </button>

      {state?.message && (
        <p role={state.success ? "status" : "alert"}>{state.message}</p>
      )}
    </form>
  );
}
```

- Input `name` attributes MUST match the Zod schema keys in `schemas.ts`.
- NEVER use `onSubmit` + `fetch` for mutations. Use `<form action={...}>` (or React Hook Form + Server Action for complex forms, per teamworkflow-frontend).

### Pending state in nested components: `useFormStatus`

```tsx
// frontend/shared/components/SubmitButton.tsx
"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();

  // Render shadcn <Button> from "@/shared/components/shadcn/button" once it is installed
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
```

> `useFormStatus` only works in a component rendered INSIDE a `<form>`. Create `SubmitButton` when the second form needs it.

### Optimistic UI: `useOptimistic`

Use only when instant feedback matters (toggles, favorites, list additions).

```tsx
// frontend/domains/tasks/components/FavoriteButton.tsx
"use client";

import { useOptimistic } from "react";
import { toggleFavorite } from "../actions";

type Props = { taskId: string; isFavorite: boolean };

export function FavoriteButton({ taskId, isFavorite }: Props) {
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(isFavorite);

  async function action() {
    setOptimisticFavorite(!optimisticFavorite);
    await toggleFavorite(taskId);
  }

  return (
    <form action={action}>
      <button type="submit" aria-pressed={optimisticFavorite}>
        {optimisticFavorite ? "★" : "☆"}
      </button>
    </form>
  );
}
```

---

## `ref` as Prop (No `forwardRef`)

Primitives (`Input`, `Button`…) come from shadcn and already follow this pattern. Apply it when writing composed components that expose a ref.

```tsx
// ✅ React 19: ref is a regular prop, already included in ComponentProps
import type { ComponentProps } from "react";

type SearchFieldProps = ComponentProps<"input"> & { label: string };

export function SearchField({ label, ref, ...props }: SearchFieldProps) {
  return (
    <label>
      {label}
      <input ref={ref} type="search" {...props} />
    </label>
  );
}
```

```tsx
// ❌ Old way (unnecessary now)
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>((props, ref) => (
  <input ref={ref} {...props} />
));
```

---

## JSX Rules

```tsx
// ✅ Expressions in braces
<TaskList tasks={tasks} onSelect={handleSelect} />

// ❌ NEVER: quotes around expressions (passes a literal string)
<TaskList tasks="{tasks}" />
```

- Every list item needs a stable `key` from data (`id`). NEVER the array index for dynamic lists.
- Buttons MUST declare `type` (`"submit"` or `"button"`).
- Handle all UI states: loading (Suspense/pending), error, empty.

---

## Checklist

- [ ] Every imported module and library exists (or was created/installed in this change)
- [ ] No deep imports across domains or from `app/`; relative imports inside the domain
- [ ] No server-only modules imported from Client Components
- [ ] Files placed per "Where React Things Go" and teamworkflow-frontend
- [ ] React Compiler enabled (or user informed)
- [ ] No `useMemo` / `useCallback` / `memo`
- [ ] Named imports only; `import type` for types
- [ ] `"use client"` only where needed, on the smallest leaf
- [ ] No data fetching or state mirroring in `useEffect`
- [ ] `use(promise)` wrapped in `<Suspense>`, promise created on the server
- [ ] Forms use `<form action>` + `useActionState`; input names match the Zod schema
- [ ] No `forwardRef`; refs typed via `ComponentProps`
- [ ] Props, state and action results typed, no `any`
- [ ] No mutation of props/state; stable `key`s on lists
- [ ] Loading, error and empty states handled
- [ ] JSX expressions use `{value}`, never `"{value}"`