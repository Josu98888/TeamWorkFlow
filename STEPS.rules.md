# STEPS.rules.md — how agents work with STEPS files

> Lives at the repository root. Applies to every `STEPS.md` in the repo (frontend, backend, any other stack).
> Each `STEPS.md` starts with: `Follow /STEPS.rules.md. Order: /STEPS.index.md.` and does not repeat these rules.

## 1. Where things live

| File | Purpose |
|---|---|
| `/STEPS.rules.md` | This file: agent rules and how to write checks. |
| `/STEPS.index.md` | Global implementation order (all stacks), cross-stack decisions, domain status. The only place the order is written. |
| `<stack>/STEPS.template.md` | Template per stack (frontend, backend…). Phases and step shapes for that stack. |
| `<stack>/<domains-dir>/<domain>/STEPS.md` | The plan for one domain in one stack. |
| `<stack>/<foundation>/STEPS.md` | Foundation of a stack (shared/core): decisions every domain of that stack references. |

### Commands per stack

Checks write `<lint>`, `<typecheck>`, etc. and mean the commands of their stack: the table below, or the stack's `STEPS.template.md` when the stack is not listed here.

| Stack | lint | typecheck | build | unit/integration tests | e2e |
|---|---|---|---|---|---|
| frontend | `pnpm lint` | `pnpm exec tsc --noEmit` | `pnpm build` | `pnpm exec playwright test -c playwright.unit.config.ts` | `pnpm exec playwright test` |
| backend | see `backend/STEPS.template.md` | | | | |

### Toolchain and paths

- Checks assume Git Bash (POSIX shell), ripgrep (`rg`) and `fd` on `PATH`. Do not use `grep`, `find` or `ls` in checks.
- Run each check from the repository root or from the stack directory (`backend/`, `frontend/`); the check says which when it matters.
- Inside a command, always use a repo-relative path (`STEPS.index.md`, `frontend/shared/STEPS.md`). A leading `/` in prose (`/STEPS.index.md`) means "repo root" and is never a filesystem path in a command.
- Commit and hash steps need git. If the repo is not a git repo, or the current branch is `main`, ask the user once, write `(no commit)` next to the phase title and continue. Never create, switch or delete branches.

## 2. Reading order for a session

1. This file.
2. `/STEPS.index.md`: confirm the domain's turn has come and its dependencies are done.
3. The stack foundation `STEPS.md` (only the decisions the domain references).
4. The domain `STEPS.md`: start at its **Status** line, not at the top.

## 3. Step markers and status line

- `[ ]` not started.
- `[~]` in progress or partially done. Write what is missing next to it.
- `[!]` blocked. Name the `TODO(...)` or the `<domain> S<x>` it waits for.
- `[x]` done. ONLY after its Check passed in this session. Never tick a step you did not verify.

Every `STEPS.md` has a status line under the title:

`**Status:** last verified: S2.3 · next: S2.4 · in progress: — · blocked: S2.5 (TODO(auth))`

The agent rewrites it after every step it ticks, starts or blocks.

## 4. Decisions: TODO vs DEFAULT

- `TODO(<scope>) <question>` is **blocking**. Stop, ask the user, then:
  1. write the answer under the file's **Decisions** section (date, who decided, answer);
  2. replace the TODO in the step with the decision;
  3. continue.
- `DEFAULT(<scope>): <value>` is **non-blocking**. Continue with the value and list it under **Defaults to confirm**.
- A step never carries both for the same question.
- Every question to the user in a STEPS file is one of the two. There are no informal "ask the user" lines.
- `<scope>` is the domain that owns the decision (`TODO(sales)`), or a cross-stack scope declared in `/STEPS.index.md` (`TODO(e2e-backend)`).
- A decision already taken in another domain or in the foundation is referenced (`see auth S2.6`), never reopened as a new TODO.

## 5. Checks

- Never weaken, reword or delete a Check to make it pass.
- If a Check fails twice, mark the step `[!]`, report what failed (command, output summary) and stop.
- If a Check needs something the agent cannot do here (a browser, a running service, credentials), report it and mark `[!]`. Never tick on assumption.
- How to write checks is in section 9.

## 6. Always ask first

- Installing, upgrading or removing a dependency.
- Changing global config (framework config, compiler/linter config, CI, env files other than `.env.example`, database settings).
- Running destructive commands (dropping data, resetting migrations, deleting files outside the domain).
- Touching another domain's files outside a "Close the loop" step.
- Changing a public contract (API endpoint, schema, error code, exported symbol) that another domain or stack already consumes.

Pre-approved (no need to ask): updating the domain status in `/STEPS.index.md` and in the `AGENTS.md` Modules table, and the `**Status:**` line of the STEPS file being worked.

## 7. Commits

- After each phase, commit per `teamworkflow-commits` with the domain as scope, max 3 files per commit. A phase may need several commits. Write every hash next to the phase title.
- A phase with `[~]`/`[!]` steps commits what is verified and notes it next to the hashes: `(partial: S6.2, S6.10 pending)`.
- Never commit secrets, real personal data, or generated test reports.

## 8. Working across domains and stacks

- **Order.** A domain only starts when every domain it depends on is done (per `/STEPS.index.md`). If a domain cannot pass its checks against the real dependency when its turn comes, the order is wrong: report it, do not work around it with mocks presented as verification.
- **Security stubs fail closed.** A missing security dependency (guards, sessions, permissions) is replaced by a stub that rejects everything, never by a comment.
- **The later domain wires back.** An earlier domain exposes a prop, slot, hook or event and does not wait. The later domain wires itself in its "Close the loop" step and ticks the deferred step in the earlier domain's STEPS.md.
- **Markers.** A domain that leaves `TODO(<other>)` markers in code has a sweep step owned by `<other>` (`rg "TODO\(<other>\)"` empty).
- **Refactors across domains** (extracting a helper to the foundation, moving a type) are separate steps listing every touched file and re-running the affected domains' tests.
- **Single owner.** Every mapping, message, constant, error code and component has one owner domain. Others import it. Claims like "only here" or "single source" are checked across the whole repo.
- **Contract between stacks.** The backend owns the API contract (endpoints, schemas, error codes, roles). The frontend never invents a field; it reads the contract in its Phase 0. A backend step that changes a published contract lists the frontend steps it affects.

## 9. Writing checks (authors)

1. **A Check is runnable or observable, with an expected result.** A command plus "is empty" / "passes", or an exact assertion. Never a state: "unticked until…", "noted", "decision recorded", "reviewed", "verified manually", "ask the user".
2. **Scope.** A Check verifies what its own step produced. Sweeps over the whole domain go in the final "Done checks" phase.
3. **Grep checks that must be empty:**
   - always exclude docs and tests: `--glob '!*.md' --glob '!tests/**'` (plus the stack's test patterns, declared in its `STEPS.template.md`);
   - exclude generated code (`--glob '!<generated-dir>/**'`, migrations if relevant);
   - use word boundaries for short words (`\blead\b`, because `lead` matches `leading-none`);
   - before relying on a grep, plant a hit in a scratch file, confirm the grep finds it, delete the file;
   - test globs containing `/` from the same search root the check uses.
4. **Prefer behavior over text.** If a rule can be checked by a test (a forbidden role gets 403, a field is absent from a response), test it. Grep is the fallback.
5. **Exact names.** Accessibility checks use the exact accessible name; API checks name the exact status code and error code.
6. **Restricted data.** Check that the value is absent from what leaves the server (response body, RSC payload, logs), not just from what is rendered.
7. **Tests map to steps.** Every test case says which steps it covers (`Covers: S5.1, S7.1`). A test with no producing step means a step is missing.
8. **Test data.** Seeds pass the domain validators, use fake data only, and run against a TEST database, never a shared or production one.
9. **Time, async and shared state.** Time-dependent cases control the clock where the logic actually runs. Async results (events, background jobs) are awaited with a defined strategy. Tests that mutate global state (config, parameters) run serially and name the suites they affect.
10. **Counting.** A check that counts entities has a verification channel (a query, a helper endpoint), not "the UI shows one".
11. **Tool alternatives.** If the obvious check needs a tool the agent may not have, give one it has (`curl -i` instead of devtools).

## 10. Writing steps (authors)

- **One step, one owner, one concern.** A step that has ten requirements gets split or gets one Check per key requirement.
- **Blocked list per step.** The Blocked table lists every step that waits on something, including indirect blocks (a step that uses a value from a blocked step is blocked too) and test cases whose data depends on a TODO.
- **Partial deferral.** If part of a step depends on a later domain, split that part into its own step (`S6.4b`) so the rest can be ticked.
- **"Not applicable" phases** stay in the file with a one-line reason, so every domain has the same shape.
- **Exports.** The export list in `AGENTS.md` (or equivalent) matches what exists. Deferred exports appear in neither until built.
- **No copied global data.** The order, commands and cross-stack decisions are referenced, never pasted into domain files.