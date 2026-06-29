// ============================================================
// Agents Orchestrator — Main Application
// Wires together blocks, editor, engine, and UI
// ============================================================

import {
  BLOCK_TYPES, createBlock, generateBlockId,
  currentDateTimeLocalValue, renderPaletteBlock, renderWorkflowBlock
} from './blocks.js';

import { ExecutionEngine } from './engine.js';

class App {
  constructor() {
    this._defaultDirectory = '.';
    /** @type {{ id: string, name: string, defaultDirectory: string, blocks: Array }} */
    this.workflow = this._normalizeWorkflow({
      id: `wf-${Date.now()}`,
      name: 'New Workflow',
      defaultDirectory: this._defaultDirectory,
      blocks: [],
    });

    this.engine = new ExecutionEngine();
    this.sortable = null;

    this._init();
    this._loadDemoWorkflow();
    this._loadDefaultDirectory();
  }

  // ── Demo Cases ─────────────────────────────────────────────
  // Pre-built demo workflows for first-time users.
  // TODO: Remove or move to a separate "templates" system later.

  _loadDemoWorkflow() {
    const demos = this._getDemoCases();
    if (demos.length > 0) {
      // Load the first demo by default
      const demo = demos[0];
      this.workflow = this._normalizeWorkflow({
        ...this.workflow,
        name: demo.name,
        defaultDirectory: demo.defaultDirectory,
        blocks: demo.blocks,
      });
      document.getElementById('workflow-name').value = demo.name;
      this.renderBlocks();
      this._onWorkflowChanged();
      this._markScheduleBlockTargetHandled(this._scheduleOf(this.workflow));
    }
  }

  _getDemoCases() {
    const defaultDirectory = this._defaultDirectory || '.';
    const defaultScheduleTime = currentDateTimeLocalValue();
    return [
      {
        name: 'Demo: Claude Auto Session',
        defaultDirectory,
        blocks: [
          {
            id: 'demo-1-schedule',
            type: 'schedule',
            // Show a useful default without auto-running the demo on app start.
            params: { datetime: defaultScheduleTime, mode: 'once' }
          },
          {
            id: 'demo-1-dir',
            type: 'directory',
            params: { path: defaultDirectory }
          },
          {
            id: 'demo-1-cmd',
            type: 'command',
            params: { command: 'claude --permission-mode bypassPermissions' }
          },
          {
            id: 'demo-1-wait1',
            type: 'wait',
            params: { duration: 20, unit: 'seconds' }
          },
          {
            id: 'demo-1-input1',
            type: 'input',
            params: { text: 'ping. reply ok only.', pressEnter: true }
          },
          {
            id: 'demo-1-wait2',
            type: 'wait',
            params: { duration: 60, unit: 'seconds' }
          },
          {
            id: 'demo-1-input2',
            type: 'input',
            params: { text: '/exit', pressEnter: true }
          },
        ]
      },
    ];
  }

  // ── Initialization ─────────────────────────────────────────

  _init() {
    this._initPalette();
    this._initEditorDrop();
    this._initToolbar();
    this._initTerminal();
    this._initResizer();
    this._initEngine();
    this._initScheduler();
    this._initSleep();
    this._updateEmptyState();
  }

  async _loadDefaultDirectory() {
    try {
      const dir = await window.api.getDefaultDirectory?.();
      if (!dir) return;

      this._defaultDirectory = dir;
      const oldDevDir = 'D:\\AI_Projects\\agents-orchestrator';
      const replaceDefaults = new Set(['', '.', oldDevDir]);
      let changed = false;

      if (replaceDefaults.has(this.workflow.defaultDirectory)) {
        this.workflow.defaultDirectory = dir;
        changed = true;
      }

      for (const block of this.workflow.blocks) {
        if (block.type === 'directory' && replaceDefaults.has(block.params?.path || '')) {
          block.params.path = dir;
          changed = true;
        }
      }

      if (changed) {
        this.renderBlocks();
        this._onWorkflowChanged();
      }
    } catch (e) {
      console.warn('Failed to load default directory', e);
    }
  }

  _normalizeWorkflow(data = {}) {
    const source = data && typeof data === 'object' ? data : {};
    const blocks = Array.isArray(source.blocks)
      ? source.blocks.map(block => this._normalizeBlock(block)).filter(Boolean)
      : [];

    return {
      id: this._safeId(source.id, `wf-${Date.now()}`),
      name: typeof source.name === 'string' && source.name.trim()
        ? source.name
        : 'Untitled Workflow',
      defaultDirectory: typeof source.defaultDirectory === 'string'
        ? source.defaultDirectory
        : this._defaultDirectory,
      blocks,
    };
  }

  _normalizeBlock(block) {
    if (!block || typeof block !== 'object' || !BLOCK_TYPES[block.type]) {
      return null;
    }

    const def = BLOCK_TYPES[block.type];
    const params = { ...def.defaultParams };
    const rawParams = block.params && typeof block.params === 'object' ? block.params : {};

    for (const paramDef of def.params) {
      if (!(paramDef.key in rawParams)) continue;
      params[paramDef.key] = this._normalizeParamValue(paramDef, rawParams[paramDef.key], params[paramDef.key]);
    }

    return {
      id: this._safeId(block.id, generateBlockId()),
      type: block.type,
      params,
    };
  }

  _normalizeParamValue(paramDef, value, fallback) {
    switch (paramDef.type) {
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        const min = Number.isFinite(Number(paramDef.min)) ? Number(paramDef.min) : -Infinity;
        const max = Number.isFinite(Number(paramDef.max)) ? Number(paramDef.max) : Infinity;
        return Math.min(max, Math.max(min, n));
      }
      case 'checkbox':
        return Boolean(value);
      case 'select':
        return paramDef.options.some(option => String(option.value) === String(value))
          ? String(value)
          : fallback;
      default:
        return value == null ? '' : String(value);
    }
  }

  _safeId(value, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return /^[a-zA-Z0-9_-]+$/.test(value) ? value : fallback;
  }

  _cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  _onWorkflowChanged() {
    if (typeof this._rebuildJobs === 'function' && Array.isArray(this._scheduledJobs)) {
      this._rebuildJobs();
    }
  }

  // ── Palette (Left Panel) ───────────────────────────────────

  _initPalette() {
    const container = document.getElementById('palette-blocks');

    for (const [type, def] of Object.entries(BLOCK_TYPES)) {
      const el = renderPaletteBlock(def);

      // Double-click → add to end
      el.addEventListener('dblclick', () => this.addBlock(type));

      // Drag from palette
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-block-type', type);
        e.dataTransfer.effectAllowed = 'copy';
        el.style.opacity = '0.4';
      });

      el.addEventListener('dragend', () => {
        el.style.opacity = '1';
      });

      container.appendChild(el);
    }
  }

  // ── Editor Canvas Drop Zone ────────────────────────────────

  _initEditorDrop() {
    const canvas = document.getElementById('editor-canvas');

    canvas.addEventListener('dragover', (e) => {
      // Only accept palette drags (not SortableJS internal drags)
      if (e.dataTransfer.types.includes('application/x-block-type')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        canvas.classList.add('drag-over');
      }
    });

    canvas.addEventListener('dragleave', (e) => {
      if (!canvas.contains(e.relatedTarget)) {
        canvas.classList.remove('drag-over');
      }
    });

    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      canvas.classList.remove('drag-over');
      const type = e.dataTransfer.getData('application/x-block-type');
      if (type && BLOCK_TYPES[type]) {
        this.addBlock(type);
      }
    });

    // Workflow name
    const nameInput = document.getElementById('workflow-name');
    nameInput.addEventListener('change', (e) => {
      this.workflow.name = e.target.value;
      this._onWorkflowChanged();
    });

    // Clear all
    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.workflow.blocks.length === 0) return;
      if (confirm('Remove all blocks from this workflow?')) {
        this.workflow.blocks = [];
        this.renderBlocks();
        this._onWorkflowChanged();
      }
    });
  }

  // ── Bottom Toolbar ─────────────────────────────────────────

  _initToolbar() {
    document.getElementById('btn-run').addEventListener('click', () => this.runWorkflow());
    document.getElementById('btn-stop').addEventListener('click', () => this.engine.abort());
    document.getElementById('btn-save').addEventListener('click', () => this.saveWorkflow());
    document.getElementById('btn-load').addEventListener('click', () => this.loadWorkflow());
    document.getElementById('btn-export').addEventListener('click', () => this.exportWorkflow());

    const themeSelect = document.getElementById('theme-selector');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        this._applyTerminalTheme(e.target.value);
      });
    }

    document.getElementById('btn-clear-log').addEventListener('click', () => {
      const log = document.getElementById('output-log');
      log.innerHTML = '';
      this._appendLog('🧹 Log cleared.', 'system');
    });

    document.getElementById('btn-clear-terminal').addEventListener('click', () => {
      this.term.clear();
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const logPane = document.getElementById('output-log');
        const termPane = document.getElementById('terminal-output');
        const resizerH = document.getElementById('resizer-h');
        if (tab === 'log') {
          logPane.style.display = 'block';
          resizerH.style.display = 'block';
          termPane.style.flex = '1';
        } else {
          logPane.style.display = 'none';
          resizerH.style.display = 'none';
          termPane.style.flex = '1';
        }
        if (this.fitAddon) this.fitAddon.fit();
      });
    });
  }

  // ── Engine Callbacks ───────────────────────────────────────

  _initEngine() {
    const engine = this.engine;

    engine.onLog = (msg, type) => this._termLog(msg, type);

    engine.onBlockStart = (index) => {
      this._forEachBlock((el, i) => {
        el.classList.remove('executing', 'done', 'error');
        if (i < index) el.classList.add('done');
        if (i === index) el.classList.add('executing');
      });
    };

    engine.onBlockEnd = (index, ok) => {
      const el = this._blockElAt(index);
      if (el) {
        el.classList.remove('executing');
        el.classList.add(ok ? 'done' : 'error');
      }
    };

    engine.onComplete = (success) => {
      // Restore toolbar
      document.getElementById('btn-run').classList.remove('hidden');
      document.getElementById('btn-stop').classList.add('hidden');

      // Status badge
      const badge = document.getElementById('workflow-status');
      badge.textContent = success ? 'Done' : 'Error';
      badge.className = `workflow-status ${success ? '' : 'error'}`;

      // Status indicator
      const dot = document.getElementById('status-indicator');
      dot.className = `status-indicator ${success ? '' : 'error'}`;
      document.getElementById('status-text').textContent = success ? 'Completed' : 'Failed';

      // Reset visual states after a delay
      setTimeout(() => {
        this._forEachBlock((el) => {
          el.classList.remove('done', 'error', 'executing');
        });
        badge.textContent = 'Idle';
        badge.className = 'workflow-status';
        dot.className = 'status-indicator';
        document.getElementById('status-text').textContent = 'Ready';
      }, 4000);
    };

    engine.onStatusChange = (status) => {
      document.getElementById('status-text').textContent = status;
    };
  }

  // ── Block CRUD ─────────────────────────────────────────────

  addBlock(type, insertIndex = -1) {
    const block = createBlock(type);

    if (insertIndex >= 0 && insertIndex < this.workflow.blocks.length) {
      this.workflow.blocks.splice(insertIndex, 0, block);
    } else {
      this.workflow.blocks.push(block);
    }

    this.renderBlocks();
    this._onWorkflowChanged();
    this._markScheduleBlockTargetHandled(block);
    this._scrollToBlock(block.id);
    return block;
  }

  removeBlock(id) {
    this.workflow.blocks = this.workflow.blocks.filter(b => b.id !== id);
    this.renderBlocks();
    this._onWorkflowChanged();
  }

  duplicateBlock(id) {
    const idx = this.workflow.blocks.findIndex(b => b.id === id);
    if (idx === -1) return;

    const original = this.workflow.blocks[idx];
    const copy = createBlock(original.type);
    copy.params = { ...original.params };

    this.workflow.blocks.splice(idx + 1, 0, copy);
    this.renderBlocks();
    this._onWorkflowChanged();
    this._markScheduleBlockTargetHandled(copy);
    this._scrollToBlock(copy.id);
  }

  // ── Render All Blocks ──────────────────────────────────────

  renderBlocks() {
    const list = document.getElementById('block-list');
    list.innerHTML = '';

    this.workflow.blocks.forEach((block, i) => {
      // Add connector line between blocks
      if (i > 0) {
        const conn = document.createElement('div');
        conn.className = 'block-connector';
        list.appendChild(conn);
      }

      const el = renderWorkflowBlock(block, i);
      if (!el) return;
      this._attachBlockEvents(el, block);
      list.appendChild(el);
    });

    this._updateEmptyState();
    this._initSortable();
  }

  _attachBlockEvents(el, block) {
    // Delete
    el.querySelector('.block-action-btn.delete')
      ?.addEventListener('click', () => this.removeBlock(block.id));

    // Duplicate
    el.querySelector('.block-action-btn.duplicate')
      ?.addEventListener('click', () => this.duplicateBlock(block.id));

    // Parameter inputs
    el.querySelectorAll('[data-param]').forEach(input => {
      const key = input.dataset.param;
      const handler = () => {
        if (input.type === 'checkbox') {
          block.params[key] = input.checked;
        } else if (input.type === 'number') {
          block.params[key] = Number(input.value);
        } else {
          block.params[key] = input.value;
        }
        if (block.type === 'schedule') this._onWorkflowChanged();
      };
      input.addEventListener('change', handler);
      if (input.type === 'text' || input.tagName === 'TEXTAREA') {
        input.addEventListener('input', handler);
      }
    });

    // Browse directory button
    el.querySelectorAll('.browse-dir-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dir = await window.api.selectDirectory();
        if (dir) {
          const key = btn.dataset.param;
          block.params[key] = dir;
          const input = el.querySelector(`input[data-param="${key}"]`);
          if (input) input.value = dir;
          if (block.type === 'schedule') this._onWorkflowChanged();
        }
      });
    });

    el.querySelectorAll('.set-now-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.param;
        const value = currentDateTimeLocalValue();
        block.params[key] = value;
        const input = el.querySelector(`input[data-param="${key}"]`);
        if (input) input.value = value;
        if (block.type === 'schedule') {
          this._onWorkflowChanged();
          this._markScheduleBlockTargetHandled(block);
          this._flashStatus('Schedule set to now');
        }
      });
    });
  }

  // ── SortableJS ─────────────────────────────────────────────

  _initSortable() {
    if (this.sortable) {
      this.sortable.destroy();
      this.sortable = null;
    }

    const list = document.getElementById('block-list');

    if (typeof Sortable === 'undefined' || this.workflow.blocks.length === 0) return;

    this.sortable = new Sortable(list, {
      handle: '.drag-handle',
      animation: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      // Filter out connector elements
      draggable: '.workflow-block',
      onEnd: (evt) => {
        // SortableJS moved DOM elements; we need to sync our data model.
        // Because connectors are interspersed, compute real block indices.
        const blockEls = [...list.querySelectorAll('.workflow-block')];
        const newOrder = blockEls.map(el => el.dataset.blockId);

        // Rebuild blocks array in the new order
        const blockMap = new Map(this.workflow.blocks.map(b => [b.id, b]));
        this.workflow.blocks = newOrder.map(id => blockMap.get(id)).filter(Boolean);

        // Re-render to fix connectors and step numbers
        this.renderBlocks();
        this._onWorkflowChanged();
      }
    });
  }

  // ── Workflow Execution ─────────────────────────────────────

  async runWorkflow(note = null) {
    if (!this.workflow || this.workflow.blocks.length === 0) {
      this._flashStatus('No blocks to run');
      return;
    }

    // Stop any currently running workflow engine
    if (this.engine.isRunning) {
      this.engine.abort();
    }

    // Prevent zombie processes: clear the default shell and anything left
    // over from previous runs before spawning fresh PTYs.
    await window.api.killAllProcesses().catch(() => {});
    this.activeProcessId = null;

    // Clear log and terminal
    document.getElementById('output-log').innerHTML = '';
    this.term.clear();
    if (note) this._appendLog(note, 'system');

    // Sync params from DOM → data
    this._syncParams();

    // Toggle buttons
    document.getElementById('btn-run').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');

    // Status badge
    const badge = document.getElementById('workflow-status');
    badge.textContent = 'Running';
    badge.className = 'workflow-status running';

    const dot = document.getElementById('status-indicator');
    dot.className = 'status-indicator running';

    // Go!
    try {
      await this.engine.execute(this.workflow.blocks, this.workflow.defaultDirectory);
    } catch (err) {
      this._termLog(`❌ Run failed: ${err.message}`, 'stderr');
      document.getElementById('btn-run').classList.remove('hidden');
      document.getElementById('btn-stop').classList.add('hidden');
      badge.textContent = 'Error';
      badge.className = 'workflow-status error';
      dot.className = 'status-indicator error';
      document.getElementById('status-text').textContent = 'Failed';
    }
  }

  _syncParams() {
    document.querySelectorAll('.workflow-block').forEach(el => {
      const id = el.dataset.blockId;
      const block = this.workflow.blocks.find(b => b.id === id);
      if (!block) return;

      el.querySelectorAll('input[data-param], select[data-param], textarea[data-param]').forEach(input => {
        const key = input.dataset.param;
        if (input.type === 'checkbox') {
          block.params[key] = input.checked;
        } else if (input.type === 'number') {
          block.params[key] = Number(input.value);
        } else {
          block.params[key] = input.value;
        }
      });
    });
  }

  // ── Save / Load / Export ───────────────────────────────────

  async saveWorkflow() {
    this._syncParams();
    this.workflow = this._normalizeWorkflow({
      ...this.workflow,
      name: document.getElementById('workflow-name').value,
    });
    document.getElementById('workflow-name').value = this.workflow.name;
    this.renderBlocks();
    this._onWorkflowChanged();

    try {
      const path = await window.api.saveWorkflow({ workflow: this.workflow });
      this._termLog(`💾 Saved → ${path}`, 'system');
      this._flashStatus('Saved');
    } catch (err) {
      this._termLog(`❌ Save failed: ${err.message}`, 'stderr');
    }
  }

  async loadWorkflow() {
    try {
      const filePath = await window.api.openFileDialog();
      if (!filePath) return;

      const data = await window.api.loadWorkflow({ filePath });
      if (!data) return;

      this.workflow = this._normalizeWorkflow(data);
      document.getElementById('workflow-name').value = this.workflow.name || 'Loaded';
      this.renderBlocks();
      this._onWorkflowChanged();
      this._termLog(`📂 Loaded: ${this.workflow.name} (${this.workflow.blocks.length} blocks)`, 'system');
    } catch (err) {
      this._termLog(`❌ Load failed: ${err.message}`, 'stderr');
    }
  }

  async exportWorkflow() {
    this._syncParams();
    this.workflow = this._normalizeWorkflow(this.workflow);
    document.getElementById('workflow-name').value = this.workflow.name;
    this.renderBlocks();
    this._onWorkflowChanged();

    try {
      const filePath = await window.api.saveFileDialog();
      if (!filePath) return;

      await window.api.saveWorkflow({ workflow: this.workflow, filePath });
      this._termLog(`📤 Exported → ${filePath}`, 'system');
    } catch (err) {
      this._termLog(`❌ Export failed: ${err.message}`, 'stderr');
    }
  }

  // ── Terminal Output ────────────────────────────────────────

  _initTerminal() {
    // Track the active PTY process ID for keyboard interaction
    // (separate from engine.currentProcessId which resets between steps)
    this.activeProcessId = null;

    this.term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', 'Consolas', monospace",
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'bar',
      disableStdin: false
    });
    this._applyTerminalTheme('ps'); // default

    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);

    const container = document.getElementById('terminal-output');
    container.innerHTML = '';
    this.term.open(container);
    this.fitAddon.fit();

    // Handle resizes
    window.addEventListener('resize', () => this.fitAddon.fit());
    this.term.onResize(({ cols, rows }) => {
      const pid = this.activeProcessId;
      if (pid) {
        window.api.resizeProcess({ id: pid, cols, rows }).catch(() => {});
      }
    });

    // Support Ctrl+C Copy (if selection exists, copy; otherwise send SIGINT)
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.code === 'KeyC' && e.type === 'keydown') {
        const selection = this.term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          this.term.clearSelection();
          return false;
        }
      }
      return true;
    });

    // Forward ALL keystrokes to the running process
    this.term.onData((data) => {
      const pid = this.activeProcessId;
      if (pid) {
        window.api.sendInput({ id: pid, text: data }).catch(() => {});
      }
    });

    // The app owns the single, persistent set of process IPC listeners.
    // They are registered exactly once here and never removed, so the
    // terminal keeps rendering across multiple workflow runs.
    window.api.onProcessOutput((data) => {
      if (data.id === this.activeProcessId) {
        if (data.stream === 'stdout' || data.stream === 'stderr') {
          this.term.write(data.data);
        }
      }
    });

    window.api.onProcessExit((data) => {
      if (data.id === this.activeProcessId) {
        this.term.write(`\r\n\x1b[90m⬡ Process exited (code ${data.code})\x1b[0m\r\n`);
        this.activeProcessId = null;
      }
      if (this.engine) this.engine.handleProcessExit(data);
    });

    window.api.onProcessError((data) => {
      if (this.engine) this.engine.handleProcessError(data);
    });

    // Start a default PowerShell session immediately so the terminal is interactive on load
    this._spawnDefaultShell();
  }

  async _spawnDefaultShell() {
    try {
      const result = await window.api.executeCommand({
        id: 'default-shell-' + Date.now(),
        command: '', // Empty command drops into an interactive PowerShell session
        cwd: this.workflow?.defaultDirectory || this._defaultDirectory || '.',
        cols: this.term.cols,
        rows: this.term.rows
      });
      if (result.error) {
        throw new Error(result.error);
      }
      this.activeProcessId = result.id;
    } catch (e) {
      console.error('Failed to start default shell', e);
    }
  }

  _applyTerminalTheme(themeName) {
    if (!this.term) return;
    const baseColors = {
      black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00',
      blue: '#3b78ff', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
      brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c',
      brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e',
      brightCyan: '#61d6d6', brightWhite: '#f2f2f2'
    };
    
    if (themeName === 'dark') {
      this.term.options.theme = { ...baseColors, background: '#0c0c0c', foreground: '#cccccc', cursor: '#ffffff', selectionBackground: '#264f78' };
    } else if (themeName === 'light') {
      this.term.options.theme = { ...baseColors, background: '#ffffff', foreground: '#333333', cursor: '#000000', selectionBackground: '#cce2ff' };
    } else {
      // ps default
      this.term.options.theme = { ...baseColors, background: '#012456', foreground: '#f2f2f2', cursor: '#ffffff', selectionBackground: '#264f78' };
    }
  }

  _initResizer() {
    // Vertical resizer (between editor and right panel)
    const resizer = document.getElementById('resizer');
    const terminalPanel = document.getElementById('terminal-panel');
    let isResizingV = false;

    resizer.addEventListener('mousedown', (e) => {
      isResizingV = true;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isResizingV) {
        const newWidth = document.body.clientWidth - e.clientX;
        if (newWidth >= 220 && newWidth <= document.body.clientWidth - 300) {
          terminalPanel.style.width = `${newWidth}px`;
          if (this.fitAddon) this.fitAddon.fit();
        }
      }
      if (isResizingH) {
        const panelRect = terminalPanel.getBoundingClientRect();
        const headerH = terminalPanel.querySelector('.panel-header').offsetHeight;
        const offset = e.clientY - panelRect.top - headerH;
        const maxH = panelRect.height - headerH - 84; // leave room for terminal
        if (offset >= 40 && offset <= maxH) {
          logPane.style.flex = `0 0 ${offset}px`;
          if (this.fitAddon) this.fitAddon.fit();
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizingV) {
        isResizingV = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = 'default';
        if (this.fitAddon) {
          this.fitAddon.fit();
          if (this.engine && this.engine.currentProcessId && this.term) {
            window.api.resizeProcess({
              id: this.engine.currentProcessId,
              cols: this.term.cols,
              rows: this.term.rows
            }).catch(() => {});
          }
        }
      }
      if (isResizingH) {
        isResizingH = false;
        resizerH.classList.remove('dragging');
        document.body.style.cursor = 'default';
        if (this.fitAddon) this.fitAddon.fit();
      }
    });

    // Horizontal resizer (between log and terminal)
    const resizerH = document.getElementById('resizer-h');
    const logPane = document.getElementById('output-log');
    let isResizingH = false;

    resizerH.addEventListener('mousedown', (e) => {
      isResizingH = true;
      resizerH.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });
  }

  // ── Scheduler & Countdown Board ────────────────────────────
  // Tracks EVERY scheduled workflow (saved on disk + the one being edited),
  // shows a live per-workflow countdown, and auto-runs each when its time
  // arrives. A workflow is "scheduled" when it contains a Schedule block
  // with a datetime.

  _initScheduler() {
    this._scheduledJobs = [];   // [{ id, name, datetime, mode, workflow, isCurrent }]
    this._diskJobs = [];        // cached workflows loaded from disk
    this._firedTargets = {};    // jobId → the target timestamp we already fired
    this._keepAwake = false;    // whether we've asked main to hold off sleep
    this._lastDiskRefresh = 0;
    this._refreshingSchedules = null;
    // Fire even if a tick lands up to 5 min late (tolerates throttling / brief
    // sleep). Also bounds staleness so ancient schedules don't fire on load.
    this._graceMs = 5 * 60 * 1000;

    const modal = document.getElementById('schedule-modal');
    const openModal = () => { this._refreshScheduledJobs(); modal?.classList.remove('hidden'); };
    const closeModal = () => modal?.classList.add('hidden');

    document.getElementById('btn-schedules')?.addEventListener('click', openModal);
    document.getElementById('btn-close-schedules')?.addEventListener('click', closeModal);
    document.getElementById('btn-refresh-schedules')?.addEventListener('click', () => this._refreshScheduledJobs());
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    this._refreshScheduledJobs();
    // Renderer-side ticker (1s) for smooth countdown display...
    this._scheduleTimer = setInterval(() => this._tickSchedules(), 1000);
    // ...plus a main-process heartbeat that keeps firing even when the window
    // is hidden in the tray or the screen is locked (Chromium would otherwise
    // throttle the renderer timer above).
    window.api.onSchedulerTick(() => this._tickSchedules());
  }

  /** Returns the first schedule block (with a datetime) of a workflow, or null. */
  _scheduleOf(wf) {
    const blocks = wf?.blocks || [];
    return blocks.find(b => b.type === 'schedule' && b.params && b.params.datetime) || null;
  }

  /** Reload scheduled workflows from disk, merge with the current one, re-render. */
  async _refreshScheduledJobs() {
    if (this._refreshingSchedules) return this._refreshingSchedules;

    this._refreshingSchedules = (async () => {
      try {
        const all = await window.api.loadWorkflow({});
        this._diskJobs = (Array.isArray(all) ? all : [])
          .map(wf => this._normalizeWorkflow(wf))
          .filter(wf => this._scheduleOf(wf));
      } catch (e) {
        this._diskJobs = [];
      } finally {
        this._lastDiskRefresh = Date.now();
        this._rebuildJobs();
        this._refreshingSchedules = null;
      }
    })();

    return this._refreshingSchedules;
  }

  /** Build the merged job list (disk ∪ current workflow) and render it. */
  _rebuildJobs() {
    const map = new Map();
    for (const wf of this._diskJobs) map.set(wf.id, wf);
    if (this.workflow) map.set(this.workflow.id, this.workflow); // current overrides its saved copy

    const jobs = [];
    for (const wf of map.values()) {
      const sb = this._scheduleOf(wf);
      if (!sb) continue;
      jobs.push({
        id: wf.id,
        name: wf.name || 'Untitled',
        datetime: sb.params.datetime,
        mode: sb.params.mode || 'once',
        workflow: wf,
        isCurrent: !!(this.workflow && wf.id === this.workflow.id),
      });
    }
    this._scheduledJobs = jobs;
    this._renderScheduleList();
  }

  /** Compute the next trigger timestamp (ms) for a job. */
  _jobTarget(job, now) {
    const base = new Date(job.datetime).getTime();
    if (isNaN(base)) return 0;
    if (job.mode === 'cron') {
      // Daily repeat at the same clock time.
      const d = new Date(job.datetime);
      const next = new Date(now);
      next.setHours(d.getHours(), d.getMinutes(), d.getSeconds() || 0, 0);
      let t = next.getTime();
      if (t < now - (this._graceMs || 300000)) t += 86_400_000; // today's window passed → tomorrow
      return t;
    }
    return base; // once
  }

  _formatCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(sec)}` : `${p(h)}:${p(m)}:${p(sec)}`;
  }

  _tickSchedules() {
    const now = Date.now();

    // Keep the currently-edited workflow's entry fresh (its datetime may change live).
    if (this.workflow) {
      const job = this._scheduledJobs.find(j => j.id === this.workflow.id);
      const sb = this._scheduleOf(this.workflow);
      if (job && sb) { job.datetime = sb.params.datetime; job.mode = sb.params.mode || 'once'; }
    }

    // Periodically re-sync the job list from disk (picks up newly saved workflows).
    // Refresh the disk list periodically (non-blocking — keep checking fires
    // this tick using the current cached list).
    if (now - this._lastDiskRefresh > 10000) this._refreshScheduledJobs();

    this._renderCountdowns(now);

    if (this.engine && this.engine.isRunning) return;

    for (const job of this._scheduledJobs) {
      const target = this._jobTarget(job, now);
      if (target <= 0) continue;
      // Due, and not stale beyond the grace window (so a late/throttled tick
      // still fires, but a schedule from hours ago doesn't fire on app load).
      if (now >= target && (now - target) <= this._graceMs) {
        // Fire once per occurrence (the target timestamp is the occurrence key).
        if (this._firedTargets[job.id] !== target) {
          this._firedTargets[job.id] = target;
          this._runScheduledJob(job);
          break;
        }
      }
    }
  }

  _runScheduledJob(job) {
    // Load the scheduled workflow into the editor, then run it.
    const wf = this._normalizeWorkflow(JSON.parse(JSON.stringify(job.workflow)));
    this.workflow = wf;
    const nameInput = document.getElementById('workflow-name');
    if (nameInput) nameInput.value = wf.name || 'Scheduled';
    this.renderBlocks();
    document.getElementById('schedule-modal')?.classList.add('hidden');
    this.runWorkflow(`⏰ Scheduled run: "${wf.name}" @ ${new Date().toLocaleString()}`);
  }

  _markScheduleBlockTargetHandled(block) {
    if (!block || block.type !== 'schedule' || !this.workflow || !Array.isArray(this._scheduledJobs)) return;
    if (this._scheduleOf(this.workflow) !== block) return;
    const target = this._jobTarget({
      datetime: block.params?.datetime,
      mode: block.params?.mode || 'once',
    }, Date.now());
    if (target > 0) {
      this._firedTargets[this.workflow.id] = target;
    }
  }

  _renderScheduleList() {
    const badge = document.getElementById('sched-badge');
    if (badge) badge.textContent = String(this._scheduledJobs.length);

    const list = document.getElementById('schedule-list');
    if (!list) return;

    if (this._scheduledJobs.length === 0) {
      list.innerHTML = `<div class="sched-empty">No scheduled workflows yet.<br>Add a <strong>Schedule</strong> block, set a time, and Save.</div>`;
      this._renderCountdowns(Date.now());
      return;
    }

    const now = Date.now();
    const sorted = [...this._scheduledJobs].sort((a, b) => this._jobTarget(a, now) - this._jobTarget(b, now));
    list.innerHTML = sorted.map(job => {
      const target = this._jobTarget(job, now);
      const valid = !isNaN(new Date(job.datetime).getTime());
      const when = valid ? new Date(target).toLocaleString() : '(invalid time)';
      const id = this._esc(job.id);
      return `
        <div class="sched-row" data-job-id="${id}">
          <div class="sched-main">
            <div class="sched-name">${job.isCurrent ? '✏️ ' : ''}${this._esc(job.name)}</div>
            <div class="sched-when">${this._esc(when)} · ${job.mode === 'cron' ? 'Daily' : 'Once'}</div>
          </div>
          <div class="sched-right">
            <div class="sched-countdown" data-job-id="${id}">—</div>
            <div class="sched-state" data-job-id="${id}"></div>
          </div>
        </div>`;
    }).join('');
    this._renderCountdowns(now);
  }

  /** Update countdown text/state in place each second (no full re-render). */
  _renderCountdowns(now) {
    let next = null;
    for (const job of this._scheduledJobs) {
      const target = this._jobTarget(job, now);
      const remaining = target - now;
      const running = !!(this.engine?.isRunning && this.workflow?.id === job.id);
      const handled = this._firedTargets[job.id] === target;
      const passed = job.mode !== 'cron' && now > target + this._graceMs;
      const sel = `[data-job-id="${this._cssEscape(job.id)}"]`;
      const cdEl = document.querySelector(`#schedule-list .sched-countdown${sel}`);
      const stEl = document.querySelector(`#schedule-list .sched-state${sel}`);

      if (cdEl) {
        cdEl.textContent = running ? 'running' : (passed ? 'passed' : (handled ? 'set' : this._formatCountdown(remaining)));
        cdEl.classList.toggle('due', !running && !passed && !handled && remaining <= 0);
        cdEl.classList.toggle('running', running);
        cdEl.classList.toggle('passed', passed);
        cdEl.classList.toggle('handled', handled && !running && !passed);
      }
      if (stEl) stEl.textContent = running ? '▶' : (passed ? '·' : (handled ? '✓' : (remaining <= 0 ? '⏰' : '')));

      if (!running && !passed && !handled && remaining > 0 && (next === null || remaining < next)) next = remaining;
    }

    const nextEl = document.getElementById('schedule-next');
    if (nextEl) nextEl.textContent = (next !== null) ? `next in ${this._formatCountdown(next)}` : '';

    // Hold off system sleep only while a future run is actually pending.
    const wantAwake = next !== null;
    if (wantAwake !== this._keepAwake) {
      this._keepAwake = wantAwake;
      window.api.setKeepAwake(wantAwake).catch(() => {});
    }
  }

  // ── Delayed Hibernate Countdown ────────────────────────────
  // A Hibernate block arms a delayed system hibernate in the main process.
  // Here we mirror the armed state as a toolbar banner with a live countdown
  // and a force-cancel button. The authoritative timer lives in main.js.

  _initSleep() {
    this._sleepTarget = null;     // epoch ms when hibernate fires (null = none)

    document.getElementById('btn-cancel-sleep')?.addEventListener('click', async () => {
      const wasArmed = await window.api.cancelSleep().catch(() => false);
      this._sleepTarget = null;
      this._renderSleepBanner();
      if (wasArmed) this._appendLog('🚫 Pending hibernate cancelled by user.', 'system');
    });

    // Main process pushes state whenever hibernate is armed / cancelled / fired.
    window.api.onSleepState((state) => {
      this._sleepTarget = state?.target ?? null;
      this._renderSleepBanner();
    });

    // Re-sync in case hibernate was armed before this renderer (re)loaded.
    window.api.getSleepState?.().then((state) => {
      this._sleepTarget = state?.target ?? null;
      this._renderSleepBanner();
    }).catch(() => {});

    // Smooth 1s countdown (backgroundThrottling is off, so this keeps ticking
    // when hidden). The actual hibernate is fired by the main-process timer.
    this._sleepTicker = setInterval(() => this._renderSleepBanner(), 1000);
    this._renderSleepBanner();
  }

  _renderSleepBanner() {
    const banner = document.getElementById('sleep-banner');
    if (!banner) return;

    const remaining = this._sleepTarget != null ? this._sleepTarget - Date.now() : -1;
    if (this._sleepTarget == null || remaining <= 0) {
      banner.classList.add('hidden');
      return;
    }

    banner.classList.remove('hidden');
    const cd = document.getElementById('sleep-countdown');
    if (cd) cd.textContent = this._formatCountdown(remaining);
  }

  _esc(str) {
    const el = document.createElement('span');
    el.textContent = String(str);
    return el.innerHTML;
  }

  _termLog(text, type = 'stdout') {
    if (type === 'stdout') {
      // Raw PTY data → xterm.js only
      if (this.term) this.term.write(text);
    } else {
      // System, stderr, input-echo → Log pane
      this._appendLog(text, type);
    }
  }

  _appendLog(text, type = 'system') {
    const log = document.getElementById('output-log');
    const line = document.createElement('div');
    line.className = `log-line ${type}`;

    // Preserve the engine's intentional blank-line spacing as a top margin,
    // so the timestamp prefix stays on the same row as the message.
    if (typeof text === 'string' && text.startsWith('\n')) {
      line.classList.add('log-spaced');
      text = text.replace(/^\n+/, '');
    }

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = this._timestamp();

    const msg = document.createElement('span');
    msg.className = 'log-msg';
    msg.textContent = text;

    line.append(time, msg);
    log.appendChild(line);
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  /** Wall-clock timestamp like "20:14:07.382" for log prefixes. */
  _timestamp() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  // ── Helpers ────────────────────────────────────────────────

  _updateEmptyState() {
    const el = document.getElementById('editor-empty');
    el.classList.toggle('hidden', this.workflow.blocks.length > 0);
  }

  _scrollToBlock(id) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-block-id="${this._cssEscape(id)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  _forEachBlock(fn) {
    document.querySelectorAll('.workflow-block').forEach((el, i) => fn(el, i));
  }

  _blockElAt(index) {
    return document.querySelectorAll('.workflow-block')[index] || null;
  }

  _flashStatus(text, duration = 2000) {
    const el = document.getElementById('status-text');
    el.textContent = text;
    setTimeout(() => { el.textContent = 'Ready'; }, duration);
  }
}

// ── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
