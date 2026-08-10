---
description: Set up the SDLC pipeline in the current project — scaffold the workspace, install the ADR template, learn the project's conventions, and write the pipeline rules into CLAUDE.md.
argument-hint: [nothing — run once per project]
---

Set up the SDLC pipeline in this project. Run once; running again updates in place without
destroying existing work.

## Steps

1. **Invoke the `sdlc-protocol` skill** so you know the layout you are creating.

2. **Scaffold the workspace** at the project root:
   - `.sdlc/` with `registry.json` containing `{"version":1,"features":[]}` if it does not
     already exist. Never overwrite an existing registry or any existing feature workspace.
   - `docs/adr/` and copy the ADR template from
     `${CLAUDE_PLUGIN_ROOT}/templates/adr-template.md` to `docs/adr/0000-template.md`.
   - If `docs/adr/` already holds ADRs, leave them alone and report the highest number so
     the architect continues the sequence rather than colliding.

3. **Write the pipeline rules into `CLAUDE.md`.** Read
   `${CLAUDE_PLUGIN_ROOT}/templates/claude-md-section.md` and merge it into the project's
   `CLAUDE.md` under a `# SDLC Pipeline` heading. If `CLAUDE.md` exists, append the section
   and do not touch anything else in the file. If the section is already there, replace just
   that section. These rules must live in the project's own `CLAUDE.md` — a plugin cannot
   contribute project context any other way.

4. **Learn the project's conventions** — this is what makes the pipeline fit *this*
   codebase rather than a generic one. Inspect and record:
   - Language, framework, and versions; the package manager
   - The exact commands for build, lint, type check, test, and dev server — read them from
     `package.json` scripts, `Makefile`, `pyproject.toml`, `pubspec.yaml`, or the CI config
     rather than assuming
   - Directory structure and layering conventions
   - Test framework, test file locations, and naming
   - The design system or component library, if any
   - Error handling and logging conventions
   - How the app runs locally, including the dev server port

   Write this to `.sdlc/project-conventions.md`. Every agent reads it, so **be exact about
   commands** — a wrong test command makes QA report false failures. Where you could not
   determine something, write "unknown" rather than a guess, and list what the human should
   fill in.

5. **Detect the surface** so phases can be skipped honestly: does this project have a UI
   (web, mobile, both, none)? Record it in `project-conventions.md`. If there is no UI, the
   design, UX audit, and UI QA phases will be skipped with that as the recorded reason.

6. **Suggest, do not impose, git hygiene.** Report whether `.sdlc/` should be committed and
   let the human decide:
   - **Commit it** (recommended) — the decision history, PRDs, and investigations live
     beside the code they produced and are reviewable in pull requests.
   - **Ignore it** — add `.sdlc/` to `.gitignore` if the team wants the workspace local.

   `docs/adr/` should always be committed.

7. **Report** what you created, the conventions you detected, the commands you will use for
   verification, anything marked unknown, and the exact command to start the first feature.

Do not create a sample feature, and do not run the pipeline. Setup only.
