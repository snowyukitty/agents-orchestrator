// ============================================================
// Workflow Execution Engine
// Runs blocks sequentially, managing processes & timing
// ============================================================

export class ExecutionEngine {
  constructor() {
    this.running = false;
    this.aborted = false;
    this.currentProcessId = null;
    this.currentBlockIndex = -1;
    this.cwd = null;

    // Callbacks — set these from the outside
    this.onLog = null;            // (message, type) => void
    this.onBlockStart = null;     // (index) => void
    this.onBlockEnd = null;       // (index, success) => void
    this.onComplete = null;       // (success) => void
    this.onStatusChange = null;   // (status) => void
  }

  // ── Public API ─────────────────────────────────────────────

  async execute(blocks, defaultCwd) {
    if (this.running) throw new Error('Engine is already running');

    this.running = true;
    this.aborted = false;
    this.cwd = defaultCwd || '.';
    this.currentProcessId = `proc-${Date.now()}`;

    this._setupProcessListeners();
    this._setStatus('running');
    this._log('▶ Workflow execution started', 'system');
    this._log(`  Working directory: ${this.cwd}`, 'system');

    let success = true;

    try {
      for (let i = 0; i < blocks.length; i++) {
        if (this.aborted) {
          this._log('⛔ Workflow aborted by user', 'system');
          success = false;
          break;
        }

        this.currentBlockIndex = i;
        const block = blocks[i];

        if (this.onBlockStart) this.onBlockStart(i);
        this._log(`\n─── Step ${i + 1}: ${block.type.toUpperCase()} ───`, 'system');

        try {
          await this._executeBlock(block);
          if (this.onBlockEnd) this.onBlockEnd(i, true);
        } catch (err) {
          this._log(`❌ Error: ${err.message}`, 'stderr');
          if (this.onBlockEnd) this.onBlockEnd(i, false);
          success = false;
          break;
        }
      }
    } finally {
      this.running = false;
      this.currentBlockIndex = -1;
      this._cleanupProcessListeners();
      this._setStatus(success ? 'completed' : 'error');
      this._log(
        `\n${success ? '✅ Workflow completed successfully' : '❌ Workflow failed'}`,
        'system'
      );
      if (this.onComplete) this.onComplete(success);
    }
  }

  abort() {
    this.aborted = true;
    if (this.currentProcessId) {
      window.api.killProcess({ id: this.currentProcessId }).catch(() => {});
    }
    this._log('🛑 Abort requested...', 'system');
  }

  get isRunning() {
    return this.running;
  }

  // ── Block Executors ────────────────────────────────────────

  async _executeBlock(block) {
    const executor = this._executors[block.type];
    if (!executor) {
      this._log(`⚠️ Unknown block type "${block.type}", skipping`, 'system');
      return;
    }
    await executor.call(this, block);
  }

  _executors = {
    schedule(block) {
      // During manual execution, schedule blocks are informational only
      const dt = block.params.datetime
        ? new Date(block.params.datetime).toLocaleString()
        : '(not set)';
      this._log(`⏰ Schedule: ${dt} [${block.params.mode}]`, 'system');
      this._log('   ℹ️  Schedule blocks only apply to timed execution, skipping.', 'system');
    },

    directory(block) {
      const p = block.params.path;
      if (!p) throw new Error('Directory path is empty');
      this.cwd = p;
      this._log(`📁 Working directory → ${p}`, 'system');
    },

    async command(block) {
      const cmd = block.params.command;
      if (!cmd) throw new Error('Command is empty');

      this._log(`⌨️  $ ${cmd}`, 'input-echo');

      const termCols = (window.app && window.app.term) ? window.app.term.cols : 80;
      const termRows = (window.app && window.app.term) ? window.app.term.rows : 24;

      const result = await window.api.executeCommand({
        id: this.currentProcessId,
        command: cmd,
        cwd: this.cwd,
        cols: termCols,
        rows: termRows
      });

      if (result.error) {
        throw new Error(`Failed to start process: ${result.error}`);
      }

      this._log(`   PID: ${result.pid}`, 'system');

      // Register the process so the terminal stays interactive
      if (window.app) {
        window.app.activeProcessId = this.currentProcessId;
      }

      // Give the process a moment to initialize
      await this._sleep(800);
    },

    async wait(block) {
      const duration = Number(block.params.duration) || 0;
      const unit = block.params.unit || 'seconds';

      let ms;
      switch (unit) {
        case 'minutes': ms = duration * 60_000; break;
        case 'hours':   ms = duration * 3_600_000; break;
        default:        ms = duration * 1_000;
      }

      this._log(`⏳ Waiting ${duration} ${unit}...`, 'system');

      const endTime = Date.now() + ms;

      while (Date.now() < endTime && !this.aborted) {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        this._setStatus(`⏳ ${display}`);
        await this._sleep(Math.min(1000, endTime - Date.now()));
      }

      if (!this.aborted) {
        this._log('⏳ Wait complete', 'system');
      }
    },

    async input(block) {
      const text = block.params.text || '';
      const pressEnter = block.params.pressEnter !== false;

      this._log(
        `📝 Sending: "${text}"${pressEnter ? ' ⏎' : ''}`,
        'input-echo'
      );

      // Simulate human typing so interactive CLIs don't drop fast chunks
      if (text) {
        for (const char of text) {
          const sent = await window.api.sendInput({
            id: this.currentProcessId,
            text: char,
          });
          if (!sent) {
            this._log('⚠️ No active process to receive input', 'stderr');
            return;
          }
          await this._sleep(75); // Slower typing (75ms) to give CLI event loops time to process
        }
      }

      if (pressEnter) {
        // Send first Enter to confirm any potential autocomplete menu selection
        await window.api.sendInput({
          id: this.currentProcessId,
          text: '\r',
        });
        
        await this._sleep(150); // Small wait for UI to update
        
        // Send second Enter to actually submit the prompt
        await window.api.sendInput({
          id: this.currentProcessId,
          text: '\r',
        });
      }
    },

    async keypress(block) {
      const key = block.params.key || 'enter';
      const keyMap = {
        'enter':  '\n',
        'ctrl+c': '\x03',
        'ctrl+d': '\x04',
        'escape': '\x1b',
        'tab':    '\t',
      };

      const char = keyMap[key] || '\n';

      this._log(`🔑 Key: ${key}`, 'input-echo');

      await window.api.sendInput({
        id: this.currentProcessId,
        text: char,
      });
    },

    loop(block) {
      const count = block.params.count || 1;
      this._log(`🔄 Loop ${count}x (not yet implemented in MVP)`, 'system');
    },

    log(block) {
      const msg = block.params.message || '';
      this._log(`📋 ${msg}`, 'system');
    },
  };

  // ── Process Event Listeners ────────────────────────────────

  _setupProcessListeners() {
    this._onOutput = (data) => {
      if (data.id === this.currentProcessId) {
        this._log(data.data, data.stream);
      }
    };

    this._onExit = (data) => {
      if (data.id === this.currentProcessId) {
        this._log(`\n⬡ Process exited (code ${data.code})`, 'system');
        if (window.app) {
          window.app.activeProcessId = null;
        }
      }
    };

    this._onError = (data) => {
      if (data.id === this.currentProcessId) {
        this._log(`❌ Process error: ${data.error}`, 'stderr');
      }
    };

    window.api.onProcessOutput(this._onOutput);
    window.api.onProcessExit(this._onExit);
    window.api.onProcessError(this._onError);
  }

  _cleanupProcessListeners() {
    window.api.removeAllListeners('process-output');
    window.api.removeAllListeners('process-exit');
    window.api.removeAllListeners('process-error');
  }

  // ── Utilities ──────────────────────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  }

  _log(message, type = 'stdout') {
    if (this.onLog) this.onLog(message, type);
  }

  _setStatus(status) {
    if (this.onStatusChange) this.onStatusChange(status);
  }
}
