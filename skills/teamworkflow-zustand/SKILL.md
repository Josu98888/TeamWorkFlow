---
name: teamworkflow-zustand
description: >
  Zustand 5 client-state patterns for TeamWorkFlow with Next.js App Router: when to use a store,
  domain stores, per-request stores via provider, selectors, persist without hydration errors,
  devtools and typing.
  Trigger: When creating or editing a Zustand store, selecting store state in components,
  persisting client state, or deciding whether client state needs a store at all.
  Placement and state-choice order come from teamworkflow-frontend (source of truth).
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.0"
  scope: [root, frontend]
  auto_invoke: "Using Zustand stores"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – Zustand 5

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. **Zustand is probably not installed and no stores exist yet.**

- Check `frontend/package.json` for `zustand` (5.x). If missing, do NOT import it: explain why a store is needed and ask before installing.
- Before creating a store, confirm a store is actually needed (see "When to Use a Store").
- Before creating a store, search for an existing one in `domains/*/store.ts` and `shared/store.ts`.

---

## Critical Rules

- Stores hold CLIENT UI state only (selection, drafts, UI toggles, wizard steps). NEVER backend data as a cache.
- NEVER fetch backend data inside stores. Data comes from Server Components; mutations go through Server Actions.
- One store per domain in `domains/<domain>/store.ts`. NEVER a global store that combines several domains.
- Stores are used ONLY from `"use client"` components and client code. NEVER in Server Components or Server Actions.
- NEVER initialize a module-level store with server or per-user data. Use the provider pattern.
- ALWAYS read with selectors. NEVER subscribe to the whole store.
- Selectors return primitives, existing references, or use `useShallow`. NEVER build new objects/arrays inside a plain selector (infinite loop in Zustand 5).
- Persisted state uses `skipHydration`, `partialize`, `version`, and is validated with Zod on rehydrate.
- Types follow teamworkflow-typescript: `type`, no `any`, no implicit `any` in slices.

---

## When to Use a Store

Follow the order from teamworkflow-frontend. Use the FIRST option that fits:

```text
1. Data from the backend?                    → Server Component props (NOT a store)
2. Shareable/bookmarkable (filters, page)?   → URL searchParams
3. Used by one component (or parent+child)?  → useState / props
4. Shared by a small subtree, rarely changes? → React context
5. Shared by distant components, changes often,
   or needs persistence across navigations?  → Zustand store
```

Good TeamWorkFlow cases: task comparison selection across pages, multi-step project wizard draft, recent searches.
Bad cases: list of tasks/projects (server data), current filters (URL), modal open state used by one component (useState).

---

## Where Stores Go

| What | Location |
|------|----------|
| Domain store (module-level) | `domains/<domain>/store.ts` |
| Domain store factory (per-request/per-instance) | `domains/<domain>/store.ts` (`createXStore`) |
| Provider + hook for a factory store | `domains/<domain>/context/<Name>StoreProvider.tsx` |
| Truly global client state (active tenant, etc.) | `shared/store.ts` |
| Persist storage keys | `teamworkflow:<domain>:<name>` |

Export hooks/providers used outside the domain through the domain's `index.ts` (client-safe).

---

## Module-Level Store (client-only UI state)

Use when the initial state is static (empty selection, defaults) and does not come from the server.

```ts
// frontend/domains/tasks/store.ts
import { create } from "zustand";

const MAX_COMPARE = 3;

type TaskCompareState = {
  selectedIds: string[];
};

type TaskCompareActions = {
  toggle: (id: string) => void;
  clear: () => void;
};

export type TaskCompareStore = TaskCompareState & TaskCompareActions;

const initialState: TaskCompareState = {
  selectedIds: [],
};

export const useTaskCompareStore = create<TaskCompareStore>()((set) => ({
  ...initialState,

  toggle: (id) =>
    set((state) => {
      if (state.selectedIds.includes(id)) {
        return { selectedIds: state.selectedIds.filter((selected) => selected !== id) };
      }
      if (state.selectedIds.length >= MAX_COMPARE) return state; // no change
      return { selectedIds: [...state.selectedIds, id] };
    }),

  clear: () => set(initialState),
}));
```

```tsx
// frontend/domains/tasks/components/CompareToggle.tsx
"use client";

import { useTaskCompareStore } from "../store";

export function CompareToggle({ taskId }: { taskId: string }) {
  // ✅ Primitive result: re-renders only when this task's selection changes
  const isSelected = useTaskCompareStore((s) => s.selectedIds.includes(taskId));
  const toggle = useTaskCompareStore((s) => s.toggle); // actions are stable

  return (
    <button type="button" aria-pressed={isSelected} onClick={() => toggle(taskId)}>
      {isSelected ? "Remove from compare" : "Compare"}
    </button>
  );
}
```

- State and actions are typed separately, then combined.
- Keep `initialState` as a constant to support `reset` / `clear`.
- Immutable updates (spread, `filter`, `map`). Do not add Immer unless the user approves it for deeply nested state.

---

## Provider Pattern (state initialized from the server)

Use when the initial state comes from server props (e.g. a draft seeded from a project), or when each page/instance needs its own store. The store is created once per component tree, so it is never shared between requests.

```ts
// frontend/domains/projects/store.ts
import { createStore } from "zustand/vanilla";

export type ProjectDraftState = {
  taskIds: string[];
  notes: string;
};

type ProjectDraftActions = {
  setNotes: (notes: string) => void;
  removeTask: (id: string) => void;
  reset: () => void;
};

export type ProjectDraftStore = ProjectDraftState & ProjectDraftActions;

export function createProjectDraftStore(initialState: ProjectDraftState) {
  return createStore<ProjectDraftStore>()((set) => ({
    ...initialState,
    setNotes: (notes) => set({ notes }),
    removeTask: (id) =>
      set((state) => ({ taskIds: state.taskIds.filter((taskId) => taskId !== id) })),
    reset: () => set(initialState),
  }));
}

export type ProjectDraftStoreApi = ReturnType<typeof createProjectDraftStore>;
```

```tsx
// frontend/domains/projects/context/ProjectDraftStoreProvider.tsx
"use client";

import { createContext, use, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import {
  createProjectDraftStore,
  type ProjectDraftState,
  type ProjectDraftStore,
  type ProjectDraftStoreApi,
} from "../store";

const ProjectDraftStoreContext = createContext<ProjectDraftStoreApi | null>(null);

type Props = { initialState: ProjectDraftState; children: ReactNode };

export function ProjectDraftStoreProvider({ initialState, children }: Props) {
  // Created once per mounted tree — never shared across requests
  const [store] = useState(() => createProjectDraftStore(initialState));
  return <ProjectDraftStoreContext value={store}>{children}</ProjectDraftStoreContext>;
}

export function useProjectDraftStore<T>(selector: (state: ProjectDraftStore) => T): T {
  const store = use(ProjectDraftStoreContext);
  if (!store) throw new Error("useProjectDraftStore must be used inside ProjectDraftStoreProvider");
  return useStore(store, selector);
}
```

```tsx
// frontend/app/(teamworkflow)/projects/[id]/edit/page.tsx (Server Component)
import { notFound } from "next/navigation";
import { getProjectById } from "@/domains/projects/server";
import { ProjectDraftStoreProvider, ProjectDraftEditor } from "@/domains/projects";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <ProjectDraftStoreProvider initialState={{ taskIds: [project.task.id], notes: project.notes ?? "" }}>
      <ProjectDraftEditor />
    </ProjectDraftStoreProvider>
  );
}
```

> Seeding a draft from server data is fine: the store holds the user's pending edits, not a cache of the backend. Saving goes through a Server Action.

---

## Selectors (Zustand 5)

```tsx
// ✅ One value per selector
const notes = useProjectDraftStore((s) => s.notes);
const setNotes = useProjectDraftStore((s) => s.setNotes);

// ✅ Derived primitive inside the selector
const count = useTaskCompareStore((s) => s.selectedIds.length);

// ✅ Several fields at once → useShallow
import { useShallow } from "zustand/react/shallow";

const { notes, taskIds } = useProjectDraftStore(
  useShallow((s) => ({ notes: s.notes, taskIds: s.taskIds })),
);

// ✅ Derived arrays: select the source, derive during render
const selectedIds = useTaskCompareStore((s) => s.selectedIds);
const hasSelection = selectedIds.length > 0;
```

```tsx
// ❌ Whole store: re-renders on ANY change
const store = useTaskCompareStore();
const { toggle, clear } = useTaskCompareStore();

// ❌ New object/array in a plain selector: infinite loop in Zustand 5
const { notes, taskIds } = useProjectDraftStore((s) => ({ notes: s.notes, taskIds: s.taskIds }));
const firstTwo = useTaskCompareStore((s) => s.selectedIds.slice(0, 2));
```

---

## Persist (without hydration errors)

Persist only what must survive reloads (preferences, recent searches). NEVER persist secrets, tokens, PII or backend data.

```ts
// frontend/domains/tasks/store.ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";

const MAX_RECENT = 10;

type RecentSearchesState = { recent: string[] };
type RecentSearchesActions = { add: (term: string) => void; clear: () => void };
type RecentSearchesStore = RecentSearchesState & RecentSearchesActions;

// localStorage is untrusted input — validate on rehydrate (teamworkflow-zod)
const persistedSchema = z.object({
  recent: z.array(z.string()).max(MAX_RECENT),
});

export const useRecentSearchesStore = create<RecentSearchesStore>()(
  persist(
    (set) => ({
      recent: [],
      add: (term) =>
        set((state) => ({
          recent: [term, ...state.recent.filter((t) => t !== term)].slice(0, MAX_RECENT),
        })),
      clear: () => set({ recent: [] }),
    }),
    {
      name: "teamworkflow:tasks:recent-searches",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ recent: state.recent }),
      merge: (persisted, current) => {
        const parsed = persistedSchema.safeParse(persisted);
        return parsed.success ? { ...current, ...parsed.data } : current;
      },
      skipHydration: true, // server and first client render match; rehydrate after mount
    },
  ),
);
```

```tsx
// frontend/domains/tasks/components/RecentSearches.tsx
"use client";

import { useEffect } from "react";
import { useRecentSearchesStore } from "../store";

export function RecentSearches() {
  const recent = useRecentSearchesStore((s) => s.recent);

  // Syncing with an external system (localStorage) — valid effect use
  useEffect(() => {
    void useRecentSearchesStore.persist.rehydrate();
  }, []);

  if (recent.length === 0) return null;

  return (
    <ul>
      {recent.map((term) => (
        <li key={term}>{term}</li>
      ))}
    </ul>
  );
}
```

- `skipHydration: true` → no hydration misproject; state loads after mount.
- `partialize` → persist data only, never actions.
- Bump `version` and add `migrate` when the persisted shape changes.
- Key format: `teamworkflow:<domain>:<name>`.

---

## Slices (only inside one domain)

Split a domain store into slices only when it grows large. Slices are typed with `StateCreator`; never combine slices from different domains.

```ts
// frontend/domains/projects/store.ts
import { create, type StateCreator } from "zustand";

type WizardSlice = {
  step: number;
  next: () => void;
  back: () => void;
};

type SelectionSlice = {
  taskId: string | null;
  selectTask: (id: string) => void;
};

type ProjectWizardStore = WizardSlice & SelectionSlice;

const createWizardSlice: StateCreator<ProjectWizardStore, [], [], WizardSlice> = (set) => ({
  step: 0,
  next: () => set((state) => ({ step: state.step + 1 })),
  back: () => set((state) => ({ step: Math.max(0, state.step - 1) })),
});

const createSelectionSlice: StateCreator<ProjectWizardStore, [], [], SelectionSlice> = (set) => ({
  taskId: null,
  selectTask: (id) => set({ taskId: id }),
});

export const useProjectWizardStore = create<ProjectWizardStore>()((...args) => ({
  ...createWizardSlice(...args),
  ...createSelectionSlice(...args),
}));
```

---

## DevTools (development only)

```ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export const useTaskCompareStore = create<TaskCompareStore>()(
  devtools(
    (set) => ({
      // …
    }),
    { name: "tasks/compare", enabled: process.env.NODE_ENV === "development" },
  ),
);
```

- Middleware order when combined: `devtools(persist(...))` — devtools outermost.

---

## Outside React

```ts
// ✅ Client-side event handlers / utilities
useTaskCompareStore.getState().clear();

// ✅ Subscriptions inside an effect, always cleaned up
useEffect(() => {
  const unsubscribe = useTaskCompareStore.subscribe((state) => {
    console.debug("compare selection", state.selectedIds.length);
  });
  return unsubscribe;
}, []);
```

- NEVER use `getState()` / `setState()` in Server Components, Server Actions or Route Handlers.
- Prefer selectors in components over `getState()` (getState does not re-render).

---

## Reset on Logout (when auth exists)

Every store with user-related state exposes `reset()` built from its `initialState`. When auth is implemented, call them on logout and clear persisted keys (`useXStore.persist.clearStorage()`).

`// TODO(auth):` until then.

---

## Checklist

- [ ] Zustand installed (5.x) — or user asked before installing
- [ ] A store is really needed (not server data, URL state, useState or context)
- [ ] Store in `domains/<domain>/store.ts`; no cross-domain global store
- [ ] No backend fetching or backend data cached in the store
- [ ] Used only from client code
- [ ] Server-seeded state uses the provider pattern, not a module-level store
- [ ] State and actions typed; slices typed with `StateCreator`; no implicit `any`
- [ ] `initialState` constant + `reset`/`clear`
- [ ] Selectors only; no whole-store reads; no new objects/arrays without `useShallow`
- [ ] Persist: `skipHydration`, `partialize`, `version`, Zod-validated `merge`, `teamworkflow:` key, no sensitive data
- [ ] DevTools enabled only in development