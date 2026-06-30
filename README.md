# Agents Orchestrator

A desktop orchestrator application built with Electron, allowing users to automate interactions with command-line AI agents (such as Claude and Codex) through a drag-and-drop block interface and an embedded pseudo-terminal (PTY).

## Project Status

**Version**: 0.1.8 MVP

### Release Notes

#### v0.1.8
- **My Workflows manager**: The **📂 Load** button now opens an in-app **My Workflows** browser that lists every saved workflow (with block count and any schedule time), instead of a bare file dialog. Click a row to open it, delete one from disk with its 🗑️ button, start a blank one with **＋ New**, or pull a `.json` from anywhere with **📥 Import file…**. The schedule board stays in sync after deletes.
- **Unsaved-changes safety**: An amber dot appears next to the workflow name whenever there are unsaved edits, and switching away (opening another workflow, New, a template, or importing a file) now asks before discarding them. Saving, loading, and scheduled runs clear the flag.

#### v0.1.7
- **Testable scheduling core**: The trigger/countdown time math (next-run for `once`/`cron`, the due-window check, and countdown formatting) is extracted into a pure, dependency-free `schedule.js` that takes `now` as an argument. Behavior is unchanged, but it's now deterministically covered by the headless self-test — `once` returns the absolute time, `cron` rolls forward exactly 24h once today's window passes, the grace window fires late-but-not-stale ticks, and countdown formatting clamps/pads/prefixes days. Scheduling regressions now fail `npm test`.

#### v0.1.6
- **Live loop progress**: While a workflow runs, the active Loop block shows a live iteration badge (e.g. `2/3`) that turns green when the loop finishes, and the status line reads `🔄 Loop 2/3`. Driven by a new `onLoopIteration` engine hook, covered by the self-test.
- **Loop grouping visuals**: Loop / End Loop markers share a tinted background so the pair reads as brackets, and the connector lines between nested blocks are indented to form a continuous nesting rail down the loop body.
- **Drop-to-position**: Dragging a block from the palette now inserts it where you drop it (a glowing insertion line previews the spot) instead of always appending to the end. Dropping a Loop still seeds its matching End Loop at that position.

#### v0.1.5
- **Loop structure validation in the editor**: Unbalanced loop markers (a Loop with no End Loop, or a stray End Loop) are now flagged inline with a dashed warning outline and an explanatory tooltip, plus a summary banner above the block list. The run still proceeds safely (the engine skips broken markers) — the warnings just make the structure obvious while editing.
- **Self-test coverage**: The headless `npm test` now also verifies every shipped template is structurally sound (balanced loops) and checks the unmatched-marker index reporting, so a malformed template or loop-analysis regression fails the build.

#### v0.1.4
- **Real Loop block**: The `loop` block now actually repeats. It pairs with a new **End Loop** (`loopEnd`) block — every block between a Loop and its matching End Loop runs `count` times. Adding a Loop auto-seeds its End Loop, nested loops are supported, and the loop body is visually indented by nesting depth. Unbalanced markers (a Loop with no End, or a stray End) are skipped with a warning instead of breaking the run.
- **Workflow Templates**: A new **🧩 Templates** picker offers pre-built starting points (Claude Auto Session, a Loop example, a nightly run + hibernate, and a quick command). Selecting one replaces the current workflow; directory/time placeholders are filled with sensible local defaults and never auto-fire on load.
- **Headless engine self-test**: `npm test` (`electron . --self-test`) runs the engine's loop control flow in a dry-run mode with no real PTYs, asserts simple/nested/zero-count/unbalanced loop behavior plus the pure loop helpers, and exits non-zero on any regression.

#### v0.1.3
- Added a one-click current-time control beside Schedule datetime fields.
- Marked default/current-minute Schedule targets as handled in the countdown board so they do not appear as immediately due.
- Preserved manual scheduling behavior: editing a Schedule to a future time still arms it normally.

#### v0.1.2
- Default/demo Schedule blocks now display the current local system time immediately.
- Newly-created Schedule blocks still suppress the just-created current-minute target once, preventing accidental immediate auto-runs while keeping future edits schedulable.

#### v0.1.1
- Hardened app shutdown: quitting from the tray now stops the scheduler heartbeat, detaches power monitor listeners, cancels pending hibernate timers, releases the keep-awake blocker, tears down the tray, and terminates tracked PTYs through one idempotent cleanup path.
- Guarded main-to-renderer IPC sends so process output, process exit, sleep-state, and scheduler heartbeat events do not throw while the renderer is closing.
- New Schedule blocks now default their `datetime-local` value to the current local system time at the moment the block is created.
- Fixed a startup Content Security Policy console error by explicitly allowing local `data:` images used by CSS controls.
- Added renderer-side IPC rejection handling for terminal input and resize calls during process teardown.
- Prevented overlapping scheduled workflow refreshes when renderer ticks and main-process heartbeat ticks arrive close together.
- Added `npm run smoke` for a quick Electron startup/shutdown smoke test that exercises the normal quit cleanup path.
- Ignored local `mcps/` tool descriptor caches in Git and packaged builds.

### Completed Features
- **Visual Workflow Builder**: Users can construct automation workflows by combining blocks (Schedule, Directory, Command, Wait, Send Input, Keypress, Loop / End Loop, Log, Hibernate PC).
- **Loops**: A **Loop** block repeats every block up to its matching **End Loop** a configurable number of times. Nested loops are supported and the loop body is indented (with a continuous nesting rail) so the structure is readable at a glance. A live iteration badge (`2/3`) tracks progress during a run, unbalanced loop markers are flagged inline (dashed outline + tooltip) and summarized in a banner, and the engine still runs safely by skipping broken markers.
- **Drag-to-Position Editing**: Blocks dragged from the palette land exactly where they are dropped (with a live insertion-line preview); they can still be reordered afterward by their drag handles.
- **Templates**: A **🧩 Templates** picker provides pre-built workflows (including a Loop example) as one-click starting points.
- **Persistent Storage**: Workflows are saved to and loaded from `%APPDATA%/agents-orchestrator/workflows/`, with atomic writes and resilient loading so one malformed workflow file does not break the whole schedule list.
- **Workflow Library**: A **📂 My Workflows** browser lists every saved workflow in-app — open, delete, start a new blank one, or import a `.json` from disk. An unsaved-changes indicator and a discard prompt prevent accidentally losing edits when switching between workflows.
- **Automated PTY Execution**: The engine executes terminal applications in the background using `node-pty` with modern Windows `ConPTY` enabled, providing full ANSI color support and proper terminal layout.
- **Dual-Pane Output**: The UI features a horizontally resizable right panel split into:
  - **Log**: A clear visual timeline of automation steps and system messages.
  - **Terminal**: A fully interactive `xterm.js` terminal representing the spawned process.
- **Theme Switcher**: Users can toggle between three terminal themes (PowerShell Blue, Hacker Dark, and Light Mode).
- **Interactive Terminal**: Terminal stays fully interactive. All keystrokes in the UI are forwarded via IPC to the actual background PowerShell process.
- **Process Cleanup**: At the start of every run, `kill-all-processes` clears the default shell and any leftover PTYs from previous runs, and each spawned PTY is tracked so aborting kills them all — preventing zombie/orphaned processes.
- **Single-Instance Guard**: Electron's single-instance lock prevents duplicate tray apps, duplicate scheduler ticks, and conflicting hibernate timers. Launching a second instance focuses the existing window instead.
- **Input Simulation**: Simulates human typing speeds for text input blocks to avoid characters being swallowed by async CLI UI redrawing loops.
- **Scheduled Countdown Board**: A **⏱ Schedules** panel lists every scheduled workflow (saved on disk + the one being edited), each with a **live countdown** to its next run. The bottom toolbar always shows "next in HH:MM:SS". Due `once` jobs auto-run at their time; `cron` mode repeats daily.
- **Schedule Defaults**: Default and newly added Schedule blocks use the current local system time as their trigger time, with a one-click control to reset back to now. Loaded workflows preserve their saved schedule values.
- **Delayed Hibernate (power saving)**: A **💤 Hibernate PC** block arms a delayed system hibernate (`shutdown /h`) after a configurable delay — e.g. ping an agent, then hibernate to save power once it's done. The timer lives in the main process so it fires reliably even when the window is minimized to the tray or the screen is locked. While armed, a top banner shows a **live countdown** with a **✕ Cancel hibernate** button to force-abort it. Arming is non-blocking, so it can sit at the end of a workflow.
- **Timestamped Logs**: Every renderer Log line and every main-process console line is prefixed with an `HH:MM:SS.mmm` timestamp.
- **Custom App Icon**: A real snowflake icon (PNG + multi-size Windows `.ico`) is used for the window, taskbar, tray, and packaged `.exe` — no default Electron icon. Regenerate from `src/assets/icon-source.png` with `npm run icons`.

### Architecture Notes
- The renderer (`app.js`) owns the single, persistent set of process IPC listeners (output/exit/error); the engine reacts via `handleProcessExit` / `handleProcessError` hooks rather than registering its own listeners. This avoids the terminal listener being torn down between runs and prevents double-rendered output.
- Main-process lifecycle cleanup is centralized and idempotent. `before-quit` and `will-quit` both run the same shutdown path so timers, power blockers, tray state, and PTYs are cleaned up consistently.
- `mcps/` is treated as a local tool descriptor cache. It is not part of the app source and is ignored by Git and packaged builds.
- Pure, side-effect-free logic is factored into dependency-free modules so it can be unit-tested deterministically: loop structure (`matchingLoopEnd` / `analyzeLoops` in `engine.js`) and scheduling time math (`schedule.js`). The headless `npm test` (`electron . --self-test`) exercises these with no real PTYs and exits non-zero on regression.

### Known Issues & Unfinished Work
- **Complex Autocomplete Stealing Enter Key**: Highly interactive CLIs (like `@inquirer/prompts` used by Claude CLI) pop up autocomplete menus that can intercept `\r` (Enter) inputs from the engine. A "double-tap" Enter is implemented to bypass the menu but may still need per-CLI tweaking.
- **Terminal Layout Shifts**: Xterm dimensions may occasionally desync with the internal PTY dimensions if the window is resized very rapidly while a process is initializing.

## Development

```bash
# Install dependencies
npm install

# Run locally
npm start

# Syntax-check JavaScript entrypoints and scripts
npm run check

# Run a quick Electron startup/shutdown smoke test
npm run smoke

# Run the headless engine self-test (loop control flow regression)
npm test

# Regenerate icon assets (icon.png + icon.ico) from src/assets/icon-source.png
npm run icons

# Build for Windows x64 (embeds icon.ico into the .exe)
npm run build
```
