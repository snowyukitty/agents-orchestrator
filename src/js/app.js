// ============================================================
// Snowy Agent Orchestrator — Main Application
// Wires together blocks, editor, engine, and UI
// ============================================================

import {
  BLOCK_TYPES, createBlock,
  renderPaletteBlock, renderWorkflowBlock
} from './blocks.js';

import { ExecutionEngine } from './engine.js';

class App {
  constructor() {
    /** @type {{ id: string, name: string, defaultDirectory: string, blocks: Array }} */
    this.workflow = {
      id: `wf-${Date.now()}`,
      name: 'New Workflow',
      defaultDirectory: 'D:\\AI_Projects\\snowy-usage-window',
      blocks: [],
    };

    this.engine = new ExecutionEngine();
    this.sortable = null;

    this._init();
    this._loadDemoWorkflow();
  }

  // ── Demo Cases ─────────────────────────────────────────────
  // Pre-built demo workflows for first-time users.
  // TODO: Remove or move to a separate "templates" system later.

  _loadDemoWorkflow() {
    const demos = this._getDemoCases();
    if (demos.length > 0) {
      // Load the first demo by default
      const demo = demos[0];
      this.workflow.name = demo.name;
      this.workflow.defaultDirectory = demo.defaultDirectory;
      this.workflow.blocks = demo.blocks;
      document.getElementById('workflow-name').value = demo.name;
      this.renderBlocks();
    }
  }

  _getDemoCases() {
    return [
      {
        name: 'Demo: Claude Auto Session',
        defaultDirectory: 'D:\\AI_Projects\\snowy-usage-window',
        blocks: [
          {
            id: 'demo-1-schedule',
            type: 'schedule',
            params: { datetime: '2026-06-08T02:00', mode: 'once' }
          },
          {
            id: 'demo-1-dir',
            type: 'directory',
            params: { path: 'D:\\AI_Projects\\snowy-usage-window' }
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
    this._updateEmptyState();
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
    });

    // Clear all
    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.workflow.blocks.length === 0) return;
      if (confirm('Remove all blocks from this workflow?')) {
        this.workflow.blocks = [];
        this.renderBlocks();
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
      log.innerHTML = '<div class="log-line system">🧹 Log cleared.</div>';
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
    this._scrollToBlock(block.id);
    return block;
  }

  removeBlock(id) {
    this.workflow.blocks = this.workflow.blocks.filter(b => b.id !== id);
    this.renderBlocks();
  }

  duplicateBlock(id) {
    const idx = this.workflow.blocks.findIndex(b => b.id === id);
    if (idx === -1) return;

    const original = this.workflow.blocks[idx];
    const copy = createBlock(original.type);
    copy.params = { ...original.params };

    this.workflow.blocks.splice(idx + 1, 0, copy);
    this.renderBlocks();
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
      }
    });
  }

  // ── Workflow Execution ─────────────────────────────────────

  async runWorkflow() {
    if (!this.workflow || this.workflow.blocks.length === 0) {
      this._flashStatus('No blocks to run');
      return;
    }

    // Prevent zombie processes: kill the active process from a previous run
    if (this.activeProcessId) {
      window.api.killProcess({ id: this.activeProcessId }).catch(() => {});
      this.activeProcessId = null;
    }

    // Stop any currently running workflow engine
    if (this.engine.isRunning) {
      this.engine.abort();
    }

    // Clear log and terminal
    document.getElementById('output-log').innerHTML = '';
    this.term.clear();

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
    await this.engine.execute(this.workflow.blocks, this.workflow.defaultDirectory);
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
    this.workflow.name = document.getElementById('workflow-name').value;

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

      this.workflow = data;
      document.getElementById('workflow-name').value = data.name || 'Loaded';
      this.renderBlocks();
      this._termLog(`📂 Loaded: ${data.name} (${data.blocks?.length || 0} blocks)`, 'system');
    } catch (err) {
      this._termLog(`❌ Load failed: ${err.message}`, 'stderr');
    }
  }

  async exportWorkflow() {
    this._syncParams();

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
        window.api.resizeProcess({ id: pid, cols, rows });
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
        window.api.sendInput({ id: pid, text: data });
      }
    });

    // Listen for process output to render in terminal
    window.api.onProcessOutput((data) => {
      if (data.id === this.activeProcessId) {
        if (data.stream === 'stdout' || data.stream === 'stderr') {
          this.term.write(data.data);
        }
      }
    });

    // Start a default PowerShell session immediately so the terminal is interactive on load
    this._spawnDefaultShell();
  }

  async _spawnDefaultShell() {
    try {
      const result = await window.api.executeCommand({
        id: 'default-shell-' + Date.now(),
        command: '', // Empty command drops into an interactive PowerShell session
        cwd: this.workflow?.defaultDirectory || 'D:\\AI_Projects\\snowy-usage-window',
        cols: this.term.cols,
        rows: this.term.rows
      });
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
            });
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

  _initScheduler() {
    // Check every second if any schedule block is matched
    setInterval(() => {
      if (this.engine && this.engine.isRunning) return;

      const scheduleBlock = this.workflow.blocks.find(b => b.type === 'schedule');
      if (!scheduleBlock || !scheduleBlock.params.datetime) return;

      const targetTime = new Date(scheduleBlock.params.datetime).getTime();
      const now = Date.now();

      // Only run if the time just passed (within the last 15 seconds)
      if (targetTime > 0 && now >= targetTime && now <= targetTime + 15000) {
        if (!this._lastAutoRun || (now - this._lastAutoRun > 60000)) {
          this._lastAutoRun = now;
          document.getElementById('output-log').innerHTML = '';
          if (this.term) this.term.clear();
          this._appendLog(`⏰ Triggering scheduled execution: ${new Date(targetTime).toLocaleString()}`, 'system');
          this.runWorkflow();
        }
      }
    }, 1000);
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
    line.textContent = text;
    log.appendChild(line);
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  _updateEmptyState() {
    const el = document.getElementById('editor-empty');
    el.classList.toggle('hidden', this.workflow.blocks.length > 0);
  }

  _scrollToBlock(id) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-block-id="${id}"]`);
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
