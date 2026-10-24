---
name: teamworkflow-commits
description: >
  Git commit rules for TeamWorkFlow: Conventional Commits with domain scopes, small and frequent commits
  (max 3 files, large files alone), branch safety (the user creates branches), staging rules, amend
  and push restrictions.
  Trigger: When committing changes, preparing commits, writing commit messages, staging files,
  or when asked to save/commit work in git.
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating git commits"
    - "Committing changes"
    - "Writing commit messages"
allowed-tools: Read, Glob, Grep, Bash
---

# TeamWorkFlow – Commits

## Critical Rules

- NEVER create, switch, rename, merge or delete branches. Always work on the current branch; the user creates branches.
- NEVER commit on `main` / `master`. If the current branch is one of them, STOP and ask the user to create a branch.
- Format: `type(scope): description` — scope is the domain (`projects`, `tasks`…) or a fixed area.
- Small, frequent commits: **max 3 files per commit**. A **large file goes alone**.
- Each commit is ONE logical change and leaves the code working.
- Stage files explicitly. NEVER `git add .`, `git add -A` or `git commit -a`.
- NEVER commit secrets or generated artifacts (`.env*` except `*.example`, `node_modules/`, `.next/`, `dist/`, `coverage/`, `test-results/`).
- NEVER add `Co-Authored-By` trailers or any AI attribution (no "Generated with ...", no tool or model names) to commit messages. Conventional Commits only.
- Commit on your own initiative after each completed, verified logical step (checks passed), on the current branch.
- NEVER `git push` without confirming with the user once (see `teamworkflow-pr`). NEVER `--force`, NEVER `--no-verify`.
- `--amend` only on the last commit and only if it has NOT been pushed.
- Commit per completed logical step, not one big batch at the end.

---

## Before Committing

```bash
git branch --show-current          # must NOT be main/master
git status
git diff --stat HEAD
git diff --numstat HEAD            # lines added/removed per file → detect large files
```

If the branch is `main` or `master`:

> "Estás en `main`. Creá una rama para este trabajo (por ejemplo `feat/projects-list`) y avisame para seguir con los commits."

Then stop. Do not commit, do not create the branch.

If there are unrelated changes that you did not make (the user's work in progress), do not stage them. Ask if unsure.

---

## Commit Size

### Rules

- **Max 3 files** per commit.
- **Large file → its own commit.** A file is large when it has **more than 200 changed lines** (`added + removed` in `git diff --numstat`) or is a **new file with more than 300 lines**.
- If one logical change spans more than 3 files, split it into consecutive commits that each keep the code working (e.g. module service and facade first, then the HTTP controller, then frontend).

### Exceptions (count as one unit, never "large")

| Files | Commit together |
|-------|-----------------|
| `package.json` + lockfile | `chore(deps): …` |
| Generated shadcn primitive (`shared/components/shadcn/<name>.tsx`) | alone or with `components.json` |
| Prisma model change + its generated migration (same data owner) | `schema.prisma` + `migrations/<timestamp>_<name>/migration.sql` (2 files) |

### Splitting a feature: example

"List projects" end to end, in order. `projects` is an illustrative domain (the real `core` modules are `auth`, `organization`, `tasks`, `notifications`, `billing`); all paths below are to create unless they already exist:

```text
1. feat(projects): add project model and migration               core/src/projects/prisma/schema.prisma, migrations/<timestamp>_create_projects/migration.sql
2. feat(projects): add project dtos and pagination               core/src/projects/dto/*.ts
3. feat(projects): add projects service and facade                projects.service.ts, projects.facade.ts, projects.module.ts
4. feat(projects): add list and get project endpoints             core/src/projects/projects.controller.ts, projects.module.ts
5. test(projects): add service tests for list and get            projects.service.spec.ts
6. feat(projects): add frontend types and api calls              frontend/domains/projects/types.ts, api.ts, server.ts
7. feat(projects): add projects list page                        ProjectsList.tsx, index.ts, app/(teamworkflow)/projects/page.tsx
```

Each step compiles on its own; the order follows dependencies (things used are committed before things that use them).

If a single file mixes two logical changes, do not try to split it interactively (`git add -p` is interactive). Commit it once with the type of its main change and mention the other in the body.

---

## Message Format

```text
type(scope): description

[optional body: why, and notable details]

[optional footer: BREAKING CHANGE: …]
```

### Types

| Type | Use for |
|------|---------|
| `feat` | New functionality (endpoint, page, component, field) |
| `fix` | Bug fix |
| `refactor` | Code change without behavior change |
| `perf` | Performance improvement (indexes, query changes) |
| `test` | Adding or updating tests only |
| `docs` | Documentation only (README, comments, test `.md` docs) |
| `style` | Formatting only (no logic change) |
| `chore` | Maintenance: dependencies, config, tooling |
| `build` | Build system or packaging |
| `ci` | CI configuration |
| `revert` | Reverting a previous commit |

### Scopes

Business domains (same names in frontend and backend):

```text
auth, organization, tasks, notifications, billing   ← core modules (module folder name)
attendance                                         ← telemetry domain
projects, teams, users, …                          ← other domains (use the domain folder name)
```

Non-domain areas:

| Scope | Use for |
|-------|---------|
| `frontend` | Frontend-wide changes not tied to one domain (scaffold, layout, providers) |
| `ui` | Design system: shadcn primitives, tokens in `globals.css`, shared components |
| `shared` | Agnostic shared code (`shared/lib`, `shared/hooks`, `app/shared`) |
| `core` | `backend/core` infrastructure shared across modules: config, the shared HTTP layer (guard, filters, rate limiting), event bus and NATS responders; not tied to one module |
| `telemetry` | `backend/telemetry` infrastructure not tied to one of its modules (`clock-ins`, `workdays`, `alerts`, `tower`): config, HTTP/WebSocket layer, NATS client |
| `gateway` | Legacy `backend/gateway` code, only until it is merged into `core` (task T6) |
| `architecture` | `docs/architecture.md` and cross-service documentation |
| `prisma` | Prisma schema, migrations and client setup not tied to one domain |
| `db` | DB-wide changes not tied to one domain (naming convention, extensions) |
| `docker` | `backend/docker-compose.yml`, Dockerfiles, container config |
| `e2e` | Playwright setup and cross-feature E2E tests |
| `deps` | Dependency changes |
| `config` | Tooling/config (`tsconfig`, `next.config`, `nest-cli.json`, `.oxlintrc`, `.gitignore`) |
| `skills` | Changes in `skills/` |

Rules:

- Domain first: if the change belongs to a domain, use the domain (`feat(projects)`), even for migrations or tests of that domain.
- One scope per commit. If a commit needs two scopes, it's two commits.
- Front vs back is clear from the description and files; don't add `frontend`/`backend` to the scope.

### Description

- English, imperative mood: `add`, `fix`, `remove` — not `added`, `adds`.
- Lowercase start, no trailing period.
- Subject line ≤ 72 characters.
- Say WHAT changed, specifically: `add pagination to projects list`, not `update stuff`.

### Body (optional)

Use it when the why isn't obvious, or to list notable details. Wrap at ~72 characters.

### Breaking changes

Changes to the frontend-backend contract (removed/renamed fields, changed response shape, changed error `code` values in `{ detail, code }`) or to the core-telemetry contract (changed NATS request patterns, changed JetStream event subjects or payloads) are breaking:

```text
feat(projects)!: return paginated envelope from list endpoint

BREAKING CHANGE: GET /api/projects now returns { items, total, page, pageSize }
instead of an array.
```

### Examples

```text
feat(projects): add list endpoint with pagination
feat(tasks): add status badge to task card
fix(projects): return 404 when project belongs to another team
refactor(projects): move status labels to labels.ts
perf(projects): add status and createdAt index
test(tasks): add service tests for status transitions
chore(deps): add zod and server-only
chore(config): enable react compiler
feat(ui): add badge primitive
docs(skills): update nest skill pagination section
feat(core): add nats responder for token verification
feat(telemetry): add clock-in ingestion endpoint
chore(docker): expose core port in compose
docs(architecture): record the core and telemetry split
feat(prisma): add team model and migration
fix(auth): validate login payload in the auth module
```

---

## Commands

### Standard commit

```bash
git add <file1> <file2> <file3>
git diff --cached --stat          # verify exactly what will be committed
git commit -m "type(scope): description"
```

### Multi-line commit

Works in every shell (PowerShell, CMD, Git Bash) — each `-m` is a paragraph:

```bash
git commit -m "feat(projects): add list endpoint with pagination" -m "Returns PageDto<ProjectDto> with page and pageSize query params, ordered by createdAt desc."
```

Git Bash / Linux / WSL only (heredoc):

```bash
git commit -m "$(cat <<'EOF'
feat(projects): add list endpoint with pagination

- Returns PageDto<ProjectDto>
- Ordered by createdAt desc
EOF
)"
```

### Amend (last commit, not pushed)

Check it hasn't been pushed first:

```bash
git status                         # "Your branch is ahead of 'origin/…'" → not pushed yet
git log --oneline @{u}..           # lists unpushed commits (errors if no upstream → never pushed)
```

```bash
git add <forgotten-file>
git commit --amend --no-edit       # same message

git commit --amend -m "type(scope): new description"   # new message
```

- If the last commit is already pushed → create a new commit instead (`fix(scope): …`).
- Never amend to sneak in an unrelated change — that's a new commit.

### Pre-commit hook failures

If a hook rejects the commit, nothing was committed. Fix the reported problem, re-stage, and run the same `git commit` again. Never bypass with `--no-verify`.

---

## Checks Before Each Commit

Run what exists (never install tools just to commit):

| Changed | Check |
|---------|-------|
| `frontend/**/*.ts(x)` | `npx tsc --noEmit` and lint script (teamworkflow-frontend) |
| `backend/<service>/**/*.ts` | From the service folder: `pnpm lint` (oxlint), `pnpm build`, `pnpm test` (jest) for the touched module, if the script exists (teamworkflow-nest) |
| `schema.prisma` / migrations | `pnpm prisma validate`; migration reviewed per teamworkflow-prisma-migrations |
| `backend/docker-compose.yml` | `docker compose config` (syntax only; do not start containers unless asked) |

If a check fails because of your change, fix it before committing. If it fails for pre-existing reasons, tell the user instead of committing broken work silently.

---

## After Committing

Report to the user what was committed:

```bash
git log --oneline -n <number_of_new_commits>
```

Mention anything left uncommitted on purpose (unrelated changes, files waiting for a decision). Do not push unless asked.

---

## Checklist

- [ ] Not on `main` / `master` (branch created by the user)
- [ ] Files staged explicitly; `git diff --cached --stat` reviewed
- [ ] ≤ 3 files; large files (> 200 changed lines or new > 300 lines) alone
- [ ] One logical change; code works after the commit
- [ ] `type(scope): description` — domain scope when applicable, imperative, lowercase, ≤ 72 chars
- [ ] Breaking contract changes marked with `!` and `BREAKING CHANGE:`
- [ ] No secrets, `.env` files or generated artifacts
- [ ] No `push`, `--force`, `--no-verify`; amend only unpushed last commit
- [ ] Available checks run; result reported
- [ ] New commits listed to the user