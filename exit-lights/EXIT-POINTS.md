# Exit-point lights (v0.1 draft)

Extends the lit/dark standard (lit = exit 0 / success, dark = anything else) from one light per
command to **one light per exit point**.

## Definitions
- **Exit point**: a place where control leaves a program or a unit of CI work. Kinds:
  - `process-exit` — a `process.exit(code)` call (static or observed).
  - `uncaught-throw` — an exception that reaches the top of the stack (`uncaughtException`).
  - `unhandled-rejection` — a promise rejection with no handler.
  - `top-level-throw` — a `throw` at module top level (static only).
  - `natural-end` — the script ran off its end (event loop drained); `process.exitCode` decides.
  - `script-end` — an npm script finished; `job-end` — a CI job finished.
- **Observed** exit points were actually hit during a run. **Static** exit points were found by scanning
  source; they are *potential* and carry light `unobserved` until a run hits them.
- **Ignored path**: anything matched by `.gitignore` (`git ls-files --others --ignored --exclude-standard`).

## Mapping to lit/dark
| kind | lit when | dark when |
|---|---|---|
| process-exit / natural-end / script-end / job-end | code is 0 | any other code, signal, or timeout |
| uncaught-throw, unhandled-rejection | never | always |
| top-level-throw (static) | — (unobserved) | when observed |

No other words are used for state. `unobserved` is not a light; it is the absence of one.

## The .gitignore rule
Untracked = unverified. Every ignored path is **dark by default**. It becomes lit only if an explicit
check names it and that check's exit point is lit (e.g. `dist/` lit by a lit `npm run build` that
declares `produces: ["dist/"]`). An ignored path counts against the roll-up only if it is **required**
(listed in `required` in the config or produced/consumed by a run); merely-present junk like
`node_modules/` is reported but not required.

## Report format (`exit-lights.json`)
```json
{
  "spec": "exit-points/0.1",
  "sha": "<commit>",
  "observed": [{ "file": "test.mjs", "line": 7, "kind": "natural-end", "code": 0, "light": "lit",
                 "command": "node test.mjs" }],
  "static":   [{ "file": "build.mjs", "line": 3, "kind": "process-exit", "light": "unobserved" }],
  "ignored":  [{ "path": "dist/", "required": true, "litBy": "npm run build", "light": "lit" }],
  "light": "lit"
}
```
`file:line` comes from the stack frame at the exit (first frame outside the wrapper); for natural ends
it is the entry script, line 0 if unknown.

## Roll-up to one commit light
The commit is **lit** iff (1) at least one exit point was observed, (2) every observed exit point is
lit, and (3) every required ignored path is lit. Otherwise **dark**. Static exit points never darken a
commit on their own; they are coverage information. The roll-up's own exit code is 0 for lit, 1 for dark,
so it composes with any lit/dark reader.
