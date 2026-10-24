---
name: teamworkflow-pr
description: >
  Pull Request creation and review hygiene for TeamWorkFlow: analyzing the branch, PR title in
  Conventional Commits with domain scope, filling the PR template, frontend/backend checklists,
  creating the PR with gh (or giving text to paste), and answering review threads.
  Trigger: When the user asks to open/create/prepare a PR, write a PR description, fill the PR
  template, or respond to review comments before re-requesting review.
  Commit rules: teamworkflow-commits.
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Create a PR with gh pr create"
    - "Write or fill a pull request description"
    - "Respond to PR review comments"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# TeamWorkFlow – Pull Requests

## Critical Rules

- Create a PR ONLY when the user asks for it.
- Branches: create/switch allowed, never rename, merge or delete (teamworkflow-commits). The PR goes from the current branch.
- Base branch: feature branches target `develop`; slice branches of a chained PR target their parent feature branch. NEVER target `main`.
- NEVER open a PR from `main` / `master`.
- Uncommitted changes are committed first, following teamworkflow-commits — or left out on purpose and mentioned.
- Pushing the branch is required to open a PR: confirm with the user once before `git push`. NEVER `--force`.
- Title follows the commit format: `type(scope): description`.
- The description is based on ALL commits in the branch, not only the last one.
- NEVER add `Co-Authored-By` trailers or any AI attribution (no "Generated with ...", no tool or model names) to commits or to the PR title/body. Conventional Commits only (teamworkflow-commits).
- Never invent evidence (screenshots, outputs, test results). Leave the checklist item unchecked and tell the user what's missing.

---

## Process

### 1. Preconditions

```bash
git branch --show-current            # must NOT be main/master
git status                           # uncommitted changes? → commit first (teamworkflow-commits)
gh --version                         # is the GitHub CLI installed?
gh auth status                       # is it logged in?
```

Find the base branch (`develop` for a feature branch, the parent feature branch for a slice branch; never `main`). The default branch is only a fallback reference:

```bash
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
# without gh:
git remote show origin               # look for "HEAD branch: …"
```

### 2. Analyze the whole branch

```bash
git fetch origin
git log origin/<base>..HEAD --oneline
git diff origin/<base>...HEAD --stat
git diff origin/<base>...HEAD
```

Identify:

- Areas touched: `frontend/`, `backend/core` (and the module inside it), `backend/telemetry`, the owner's `prisma/migrations/`, `backend/docker-compose.yml`, `docs/`, `skills/`.
- Domains touched: `core` modules (`auth`, `organization`, `tasks`, `notifications`, `billing`), `attendance` (telemetry), …
- Contract changes: frontend <-> backend public HTTP API (fields, response shapes, `{ detail, code }` error codes) and `core` <-> `telemetry` (NATS request patterns, JetStream event subjects and payloads).
- Breaking changes (commits with `!` or `BREAKING CHANGE:`).

If the branch is behind the base, tell the user (rebasing/merging the base is their decision).

### 3. Title

Same format as commits (teamworkflow-commits):

```text
feat(projects): add projects list with pagination
fix(tasks): show correct status after task creation
```

- One domain → that domain as scope.
- Several domains → the main one, or ask the user if there's no clear main domain.
- Mixed types → the type of the main change (`feat` wins over `test`/`refactor` in the same feature).
- Breaking contract change → `feat(projects)!: …`.
- ≤ 72 characters, English, imperative, lowercase.

### 4. Body

Fill the template (see "PR Template"). Keep it concrete:

- **Context**: why (problem, issue link: `Closes #12`).
- **Description**: what changed, grouped by area; mention migrations and contract changes explicitly.
- **Steps to review**: exact steps to verify (URLs, commands, test data).
- **Checklist**: only sections that apply; delete the others.

### 5. Push (with confirmation)

```bash
git log --oneline @{u}..             # unpushed commits (errors if no upstream yet)
```

Ask once: "To open the PR I need to push the branch `<branch>`. Should I push it?" Then:

```bash
git push -u origin <branch>          # first push
git push                             # later pushes
```

### 6. Create the PR

Write the body to a temporary file (works in PowerShell, CMD and Git Bash), create the PR, delete the file:

```bash
gh pr create --base <base> --title "feat(projects): add projects list with pagination" --body-file pr-body.md
gh pr create --draft --base <base> --title "…" --body-file pr-body.md    # work in progress
```

- Use `--draft` when checks fail, evidence is missing, or the user says it's not finished.
- Never commit the temporary body file.

**Without `gh`** (not installed or not logged in): don't install it. Give the user the title and the full body in a Markdown block to paste on GitHub, plus the compare URL if known.

### 7. Report

Share the PR URL (or the text to paste), and list unchecked checklist items and anything the user must add (screenshots, outputs).

---

## PR Template

If `.github/pull_request_template.md` exists, use it. If not, use this one, and offer to create the file (ask first):

```markdown
### Context

{Why this change? Problem or goal. Link issues: `Closes #XX`}

### Description

{What changed, grouped by area (frontend / core / telemetry / database / docker). Mention migrations, new endpoints,
contract changes and new dependencies.}

### Steps to review

1. {Setup: branch, `docker compose up` in `backend/` (or `pnpm start:dev` per app), `pnpm prisma migrate deploy`, env vars if new}
2. {Where to go / what to call}
3. {Expected result}

### Checklist

- [ ] Commits follow `type(scope): description` and are small (teamworkflow-commits)
- [ ] Tests added or updated for the change (or explained why not)
- [ ] No secrets, `.env` files or generated artifacts committed

#### Frontend (if applicable)

- [ ] Type check and lint pass
- [ ] Loading, error and empty states handled
- [ ] Screenshots/Video — Mobile (< 640px)
- [ ] Screenshots/Video — Tablet (640px – 1024px)
- [ ] Screenshots/Video — Desktop (> 1024px)
- [ ] E2E tests updated and their `.md` docs in sync (if E2E exists)

#### Backend (if applicable)

- [ ] Endpoint request/response example (`core` `/api/...` or `telemetry` `/api/v1/telemetry/...`), including the `{ detail, code }` error case
- [ ] Per touched app (`backend/core`, `backend/telemetry`): `pnpm lint` (oxlint), `pnpm build` and `pnpm test` (jest) pass
- [ ] NATS request patterns and JetStream events changed on the producer, every consumer and the docs of both services in the same PR (teamworkflow-nest)
- [ ] Prisma migration reviewed and applied cleanly on a fresh database (teamworkflow-prisma-migrations)
- [ ] `docker compose config` valid if `backend/docker-compose.yml` changed
- [ ] EXPLAIN output for new or changed queries/indexes (teamworkflow-postgres)
- [ ] Frontend contract kept, or `types.ts` / Zod updated in this PR; breaking changes marked

#### Skills (if applicable)

- [ ] Related skills updated so rules aren't duplicated or contradictory
```

### Filling rules

- Remove sections that don't apply instead of leaving them empty.
- Check an item only if it's actually true. Unknown → unchecked + tell the user.
- Evidence the agent can produce (command outputs, test results, EXPLAIN output, example responses from a running dev server) → include it. Evidence it can't (screenshots) → leave unchecked and ask the user.
- Migrations: name the Prisma migration folders and say whether a backfill script must run after deploy.

---

## Review Threads

### Before re-requesting review (REQUIRED)

Every open review thread must be resolved or explicitly answered:

1. **Agreed + fixed**: commit the fix (teamworkflow-commits), push (with confirmation), and reply with the commit hash:
   > Fixed in `abc1234`.
2. **Agreed but deferred**: explain why it's out of scope and where it's tracked (issue link).
3. **Disagreed**: reply with clear technical reasoning. Never leave a thread silently open.
4. **Re-request review** only when every thread is resolved or answered.

> A reviewer should never have to wonder "did they see my comment?".

### Reading and answering with `gh`

```bash
gh pr view --comments                 # PR conversation
gh pr view --web                      # open in browser for inline threads
gh pr comment <number> --body-file reply.md
```

Draft replies for the user to review before posting when the answer involves a disagreement or a scope decision.

---

## Checklist

- [ ] User asked for the PR; not on `main` / `master`
- [ ] All work committed per teamworkflow-commits (or exclusions mentioned)
- [ ] Whole branch analyzed against the base (`log` + `diff`)
- [ ] Title `type(scope): description`, breaking changes marked with `!`
- [ ] Template filled; non-applicable sections removed; no invented evidence
- [ ] Branch pushed only after user confirmation; no `--force`
- [ ] PR created with `--body-file` (or text given to paste without `gh`)
- [ ] URL and missing items reported to the user