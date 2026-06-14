// ============================================================
// Agents Orchestrator — Electron Main Process
// System Tray Application with Process Automation
// ============================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, powerMonitor, powerSaveBlocker } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const pty = require('node-pty');

// ── Timestamped Logging ──────────────────────────────────────
// Prefix every main-process console line with a local HH:MM:SS.mmm
// timestamp so logs are correlatable with the renderer's Log pane.
(() => {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = () => {
    const d = new Date();
    return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}]`;
  };
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => orig(stamp(), ...args);
  }
})();

// ── GPU Compatibility Fix (prevents invisible windows on some Windows machines)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// ── Keep the scheduler alive when minimized / in tray / screen locked ──
// Chromium otherwise throttles background/occluded renderers (timers drop to
// ~1/minute), which makes scheduled runs miss their trigger window. These
// switches + backgroundThrottling:false + a main-process heartbeat keep the
// renderer's scheduler ticking whenever the machine is awake.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let mainWindow;
let tray;
const activeProcesses = new Map();

// ── Tray Icon ────────────────────────────────────────────────
function getTrayIcon() {
  const iconPath = path.join(__dirname, 'src', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // Fallback: create a minimal 16x16 cyan pixel icon
  const size = 16;
  const channels = 4;
  const raw = Buffer.alloc(size * size * channels);
  for (let i = 0; i < size * size; i++) {
    raw[i * 4]     = 74;  // R
    raw[i * 4 + 1] = 158; // G
    raw[i * 4 + 2] = 255; // B
    raw[i * 4 + 3] = 255; // A
  }
  return nativeImage.createFromBitmap(raw, { width: size, height: size });
}

function getWindowIcon() {
  // Prefer the multi-size .ico on Windows (sharp taskbar/title-bar icon),
  // fall back to the PNG everywhere else.
  const icoPath = path.join(__dirname, 'src', 'assets', 'icon.ico');
  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    const img = nativeImage.createFromPath(icoPath);
    if (!img.isEmpty()) return img;
  }
  const iconPath = path.join(__dirname, 'src', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return undefined;
}

// ── Window Creation ──────────────────────────────────────────
function createWindow() {
  const icon = getWindowIcon();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    show: false,
    center: true,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep timers full-speed when hidden/locked
    }
  });

  mainWindow.loadFile('src/index.html');

  // Show window only after content is fully rendered
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    console.log('[Main] Window shown and focused');
  });

  // Clicking X hides to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      console.log('[Main] Window hidden to tray');
    }
  });

  // Debug: log page load errors
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Main] Page load failed: ${code} - ${desc}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded successfully');
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ── System Tray ──────────────────────────────────────────────
function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🎛️ Agents Orchestrator',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '📋 Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '🔄 Restart',
      click: () => {
        app.isQuitting = true;
        app.relaunch();
        app.quit();
      }
    },
    { type: 'separator' },
    {
      label: '❌ Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Agents Orchestrator');
  tray.setContextMenu(contextMenu);

  // Left-click on tray icon shows/focuses window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  console.log('[Main] System tray created');
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  console.log('[Main] App ready, creating window and tray...');
  createWindow();
  createTray();
  startSchedulerHeartbeat();
});

// ── Scheduler Heartbeat ──────────────────────────────────────
// A main-process (Node) timer is NOT subject to Chromium's renderer
// throttling, so it reliably fires even when the window is hidden in the
// tray or the screen is locked (as long as the machine is awake). It nudges
// the renderer to re-evaluate its schedules every few seconds.
function startSchedulerHeartbeat() {
  const tick = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scheduler-tick');
    }
  };
  setInterval(tick, 5000);

  // After the system wakes from sleep, immediately re-check (a run may be due).
  try {
    powerMonitor.on('resume', () => {
      console.log('[Main] System resumed from sleep — re-checking schedules');
      tick();
    });
    powerMonitor.on('unlock-screen', () => tick());
  } catch (e) {
    console.warn(`[Main] powerMonitor unavailable: ${e.message}`);
  }
}

app.on('window-all-closed', () => {
  // On Windows, don't quit when all windows are closed (tray keeps running)
  // Only quit if isQuitting flag is set
});

app.on('before-quit', () => {
  // Kill all active child processes
  activeProcesses.forEach((proc, id) => {
    console.log(`[Main] Killing process: ${id}`);
    try { proc.kill('SIGTERM'); } catch (e) { /* ignore */ }
  });
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── IPC: Execute Command ─────────────────────────────────────
ipcMain.handle('execute-command', async (_event, { id, command, cwd, cols = 80, rows = 24 }) => {
  try {
    console.log(`[IPC] execute-command: "${command}" in "${cwd}"`);

    // If a process is already registered under this id, kill it first so we
    // never overwrite the Map entry and orphan the old PTY.
    const existing = activeProcesses.get(id);
    if (existing) {
      try { existing.kill(); } catch (e) { /* ignore */ }
      activeProcesses.delete(id);
    }

    // Validate the working directory — a missing path makes ConPTY fail with
    // "Cannot create process, error code: 267" and leaves a dead terminal.
    let workingDir = cwd;
    if (!workingDir || !fs.existsSync(workingDir)) {
      const fallback = app.getPath('home');
      if (workingDir) console.warn(`[IPC] cwd not found: "${workingDir}" — falling back to "${fallback}"`);
      workingDir = fallback;
    }

    // Using node-pty with ConPTY (wmux-inspired config)
    const proc = pty.spawn('powershell.exe', ['-NoExit', '-Command', command], {
      name: 'xterm-color',
      cols: cols,
      rows: rows,
      cwd: workingDir,
      env: process.env,
      useConpty: true,
      conptyInheritCursor: true
    });

    activeProcesses.set(id, proc);

    proc.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id, data: data.toString(), stream: 'stdout'
        });
      }
    });

    proc.onExit(({ exitCode }) => {
      activeProcesses.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-exit', { id, code: exitCode });
      }
    });

    return { id, pid: proc.pid };
  } catch (err) {
    console.error(`[IPC] execute-command error: ${err.message}`);
    return { id, error: err.message };
  }
});

// ── IPC: Send Input to Process ───────────────────────────────
ipcMain.handle('send-input', async (_event, { id, text }) => {
  const proc = activeProcesses.get(id);
  if (proc) {
    proc.write(text.replace(/\n/g, '\r'));
    return true;
  }
  return false;
});

// ── IPC: Resize Process ──────────────────────────────────────
ipcMain.handle('resize-process', async (_event, { id, cols, rows }) => {
  const proc = activeProcesses.get(id);
  if (proc && typeof proc.resize === 'function') {
    try {
      proc.resize(cols, rows);
      return true;
    } catch (e) {
      console.error(`[IPC] resize error: ${e.message}`);
    }
  }
  return false;
});

// ── IPC: Kill Process ────────────────────────────────────────
ipcMain.handle('kill-process', async (_event, { id }) => {
  const proc = activeProcesses.get(id);
  if (proc) {
    try {
      proc.kill('SIGTERM');
    } catch (e) {
      try { process.kill(proc.pid, 'SIGTERM'); } catch (e2) { /* ignore */ }
    }
    activeProcesses.delete(id);
    return true;
  }
  return false;
});

// ── IPC: Keep Awake (power save blocker) ─────────────────────
// The renderer requests this ON while any future scheduled run is pending,
// so the machine won't sleep through a scheduled time. The display is still
// allowed to turn off ('prevent-app-suspension'), only system sleep is held.
let keepAwakeId = null;
ipcMain.handle('set-keep-awake', async (_event, { on }) => {
  if (on) {
    if (keepAwakeId === null || !powerSaveBlocker.isStarted(keepAwakeId)) {
      keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`[IPC] keep-awake ON (blocker ${keepAwakeId}) — system sleep held for pending schedule`);
    }
  } else if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) {
    powerSaveBlocker.stop(keepAwakeId);
    console.log(`[IPC] keep-awake OFF (blocker ${keepAwakeId})`);
    keepAwakeId = null;
  }
  return keepAwakeId !== null;
});

// ── IPC: Delayed System Hibernate ────────────────────────────
// The renderer arms a delayed hibernate (e.g. "hibernate in 5 min") via a
// Hibernate block — used to save power after an agent run finishes. The timer
// lives HERE in the main process (a Node timer isn't throttled by Chromium),
// so it fires reliably even when the window is hidden in the tray. The
// renderer shows a live countdown and can force-cancel it.
//
// Hibernate (`shutdown /h`) is deliberate: it has single, predictable
// behavior, unlike SetSuspendState which silently hibernates anyway when
// system hibernation is enabled.
let sleepTimer = null;
let sleepTarget = null;     // epoch ms when hibernate fires (null = none armed)

function broadcastSleepState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sleep-state', { target: sleepTarget });
  }
}

function runHibernate() {
  // Release any sleep-blocker first so hibernate isn't held off.
  if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
  }
  try {
    spawn('shutdown', ['/h'], { windowsHide: true });
    console.log('[Hibernate] Triggered system hibernate');
  } catch (err) {
    console.error(`[Hibernate] Failed: ${err.message}`);
  }
}

ipcMain.handle('arm-sleep', async (_event, { delayMs }) => {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  const ms = Math.max(0, Number(delayMs) || 0);
  sleepTarget = Date.now() + ms;
  console.log(`[Hibernate] Armed: in ${Math.round(ms / 1000)}s`);
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    sleepTarget = null;
    broadcastSleepState();
    runHibernate();
  }, ms);
  broadcastSleepState();
  return { target: sleepTarget };
});

ipcMain.handle('cancel-sleep', async () => {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  const wasArmed = sleepTarget !== null;
  sleepTarget = null;
  if (wasArmed) console.log('[Hibernate] Cancelled by user');
  broadcastSleepState();
  return wasArmed;
});

ipcMain.handle('get-sleep-state', async () => ({ target: sleepTarget }));

// ── IPC: Kill All Processes ──────────────────────────────────
// Used at the start of a run to clear the default shell and any
// leftover processes from previous runs, preventing PTY leaks.
ipcMain.handle('kill-all-processes', async () => {
  let count = 0;
  activeProcesses.forEach((proc, id) => {
    try { proc.kill('SIGTERM'); count++; } catch (e) { /* ignore */ }
  });
  activeProcesses.clear();
  if (count) console.log(`[IPC] kill-all-processes: terminated ${count} process(es)`);
  return count;
});

// ── IPC: Save Workflow ───────────────────────────────────────
ipcMain.handle('save-workflow', async (_event, { workflow, filePath }) => {
  const dir = path.join(app.getPath('userData'), 'workflows');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const target = filePath || path.join(dir, `${workflow.id}.json`);
  fs.writeFileSync(target, JSON.stringify(workflow, null, 2), 'utf-8');
  return target;
});

// ── IPC: Load Workflow ───────────────────────────────────────
ipcMain.handle('load-workflow', async (_event, { filePath }) => {
  if (filePath) {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  }
  const dir = path.join(app.getPath('userData'), 'workflows');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
    return { file: f, ...JSON.parse(raw) };
  });
});

// ── IPC: Directory Picker ────────────────────────────────────
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: File Dialogs ────────────────────────────────────────
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Workflow', extensions: ['json'] }],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('save-file-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Workflow', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePath;
});
