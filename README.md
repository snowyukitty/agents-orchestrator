# Snowy Agent Orchestrator

A desktop orchestrator application built with Electron, allowing users to automate interactions with command-line AI agents (such as Claude and Codex) through a drag-and-drop block interface and an embedded pseudo-terminal (PTY).

## Project Status

**Version**: 0.1.0 MVP

### Completed Features
- **Visual Workflow Builder**: Users can construct automation workflows by combining blocks (Schedule, Directory, Command, Wait, Send Input, Keypress, Loop).
- **Persistent Storage**: Workflows are automatically saved to and loaded from `%APPDATA%/SnowyOrchestrator/workflows/`.
- **Automated PTY Execution**: The engine executes terminal applications in the background using `node-pty` with modern Windows `ConPTY` enabled, providing full ANSI color support and proper terminal layout.
- **Dual-Pane Output**: The UI features a horizontally resizable right panel split into:
  - **Log**: A clear visual timeline of automation steps and system messages.
  - **Terminal**: A fully interactive `xterm.js` terminal representing the spawned process.
- **Theme Switcher**: Users can toggle between three terminal themes (PowerShell Blue, Hacker Dark, and Light Mode).
- **Interactive Terminal**: Terminal stays fully interactive. All keystrokes in the UI are forwarded via IPC to the actual background PowerShell process.
- **Process Cleanup**: Built-in process management kills old or orphaned processes before starting new workflow executions to prevent zombie processes.
- **Input Simulation**: Simulates human typing speeds for text input blocks to avoid characters being swallowed by async CLI UI redrawing loops.

### Known Issues & Unfinished Work
- **Initial Terminal Display Issue**: While `app.js` correctly spawns an empty default shell to provide an interactive prompt right when the app loads, the prompt is still currently hidden or unresponsive on the first UI render for some edge cases. Needs deeper lifecycle investigation.
- **Complex Autocomplete Stealing Enter Key**: Highly interactive CLIs (like `@inquirer/prompts` used by Claude CLI) pop up autocomplete menus that can intercept `\r` (Enter) inputs from the engine. Although a "double-tap" logic was implemented to bypass the menu, it may still require further edge-case tweaking to be perfectly stable across all environments and CLIs.
- **Terminal Layout Shifts**: Xterm dimensions may occasionally desync with the internal PTY process dimensions if window resizing happens too rapidly while a process is initializing.

## Development

```bash
# Install dependencies
npm install

# Run locally
npm start

# Build for Windows x64
npm run build
```
