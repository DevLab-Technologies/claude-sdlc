# Protocol — design authority

Loaded by agents that read or write design artifacts. Core protocol section 2a.

## 2a. Two design artifacts, one authority split

A feature may carry a Figma design as well as the markdown design specification. The full contract
is the `sdlc-figma-design` skill; three rules matter to every agent, whether or not it ever opens
Figma.

1. **Only `sdlc-figma-designer` talks to Figma.** It exports what it read into
   `03b-figma/v<N>/` — extracted per-screen specs, reference renders, tokens, and a Figma-to-code
   component mapping. Every other agent reads those files. Nobody else needs Figma access, and no
   phase blocks on Figma being reachable.
2. **Implement against a `published` version, never a `draft` and never the live file.** Versions
   are immutable once published; a change is `v<N+1>`. `state.json` -> `design_version` names the
   current one, or `null`.
3. **Authority splits by kind of question.** Visual properties — layout, spacing, type scale,
   color, radius, elevation, component composition — follow the published design version when one
   exists. Behavioral properties — which states exist, validation, copy strings, focus order,
   accessibility semantics, analytics — follow `03-design/*.md`, always, because that is what the
   UX audit ran against. With no published version, `03-design/*.md` governs everything.

Where the two disagree inside one column, that is a `major` defect: follow `03-design/*.md`, open an
issue naming both files and both values, and bus `sdlc-ux-designer`. Never split the difference.

**A newly published design version makes later sign-offs stale**, exactly as a code change does
(section 7): a `review`, `qa`, or `ui-qa` pass recorded before the publish no longer covers the
current design, and those gates re-run in the current cycle. Gate key `figma-design`; `skipped` with
a recorded reason when there is no Figma, no access, or no user-facing surface.

