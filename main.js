// ============================================================
// Snowy Agent Orchestrator — Electron Main Process
// System Tray Application with Process Automation
// ============================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const pty = require('node-pty');

// ── GPU Compatibility Fix (prevents invisible windows on some Windows machines)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

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
      label: '🧊 Snowy Agent Orchestrator',
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

  tray.setToolTip('Snowy Agent Orchestrator');
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
});

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

    // Using node-pty with ConPTY (wmux-inspired config)
    const proc = pty.spawn('powershell.exe', ['-NoExit', '-Command', command], {
      name: 'xterm-color',
      cols: cols,
      rows: rows,
      cwd: cwd || __dirname,
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
