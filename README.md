# Agents Orchestrator

A desktop orchestrator application built with Electron, allowing users to automate interactions with command-line AI agents (such as Claude and Codex) through a drag-and-drop block interface and an embedded pseudo-terminal (PTY).

## Project Status

**Version**: 0.1.3 MVP

### Release Notes

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
- **Visual Workflow Builder**: Users can construct automation workflows by combining blocks (Schedule, Directory, Command, Wait, Send Input, Keypress, Loop, Log, Hibernate PC).
- **Persistent Storage**: Workflows are saved to and loaded from `%APPDATA%/agents-orchestrator/workflows/`, with atomic writes and resilient loading so one malformed workflow file does not break the whole schedule list.
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

### Known Issues & Unfinished Work
- **Complex Autocomplete Stealing Enter Key**: Highly interactive CLIs (like `@inquirer/prompts` used by Claude CLI) pop up autocomplete menus that can intercept `\r` (Enter) inputs from the engine. A "double-tap" Enter is implemented to bypass the menu but may still need per-CLI tweaking.
- **`loop` block**: Currently a no-op stub (flat block list has no nesting model yet).
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

# Regenerate icon assets (icon.png + icon.ico) from src/assets/icon-source.png
npm run icons

# Build for Windows x64 (embeds icon.ico into the .exe)
npm run build
```
