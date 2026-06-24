// ============================================================
// Block Type Definitions & Rendering
// ============================================================

// ── Block Type Registry ──────────────────────────────────────
export const BLOCK_TYPES = {
  schedule: {
    type: 'schedule',
    icon: '⏰',
    label: 'Schedule',
    description: 'Set trigger time',
    color: 'schedule',
    defaultParams: { datetime: '', mode: 'once' },
    params: [
      { key: 'datetime', label: 'Time', type: 'datetime-local' },
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'once', label: 'Once' },
          { value: 'cron', label: 'Cron' }
        ]
      }
    ]
  },
  directory: {
    type: 'directory',
    icon: '📁',
    label: 'Directory',
    description: 'Set working directory',
    color: 'directory',
    defaultParams: { path: '' },
    params: [
      { key: 'path', label: 'Path', type: 'directory', placeholder: 'Working directory...' }
    ]
  },
  command: {
    type: 'command',
    icon: '⌨️',
    label: 'Command',
    description: 'Run terminal command',
    color: 'command',
    defaultParams: { command: '' },
    params: [
      { key: 'command', label: 'Cmd', type: 'text', placeholder: 'e.g. claude --permission-mode bypassPermissions' }
    ]
  },
  wait: {
    type: 'wait',
    icon: '⏳',
    label: 'Wait',
    description: 'Pause execution',
    color: 'wait',
    defaultParams: { duration: 5, unit: 'seconds' },
    params: [
      { key: 'duration', label: 'Time', type: 'number', min: 0 },
      {
        key: 'unit', label: 'Unit', type: 'select',
        options: [
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' }
        ]
      }
    ]
  },
  input: {
    type: 'input',
    icon: '📝',
    label: 'Send Input',
    description: 'Type into process',
    color: 'input',
    defaultParams: { text: '', pressEnter: true },
    params: [
      { key: 'text', label: 'Text', type: 'text', placeholder: 'Text to send...' },
      { key: 'pressEnter', label: 'Enter', type: 'checkbox' }
    ]
  },
  keypress: {
    type: 'keypress',
    icon: '🔑',
    label: 'Keypress',
    description: 'Send special key',
    color: 'keypress',
    defaultParams: { key: 'enter' },
    params: [
      {
        key: 'key', label: 'Key', type: 'select',
        options: [
          { value: 'enter', label: 'Enter' },
          { value: 'ctrl+c', label: 'Ctrl + C' },
          { value: 'ctrl+d', label: 'Ctrl + D' },
          { value: 'escape', label: 'Escape' },
          { value: 'tab', label: 'Tab' }
        ]
      }
    ]
  },
  loop: {
    type: 'loop',
    icon: '🔄',
    label: 'Loop',
    description: 'Repeat N times',
    color: 'loop',
    defaultParams: { count: 3 },
    params: [
      { key: 'count', label: 'Times', type: 'number', min: 1, max: 999 }
    ]
  },
  log: {
    type: 'log',
    icon: '📋',
    label: 'Log',
    description: 'Print a message',
    color: 'log',
    defaultParams: { message: '' },
    params: [
      { key: 'message', label: 'Msg', type: 'text', placeholder: 'Log message...' }
    ]
  },
  sleep: {
    type: 'sleep',
    icon: '💤',
    label: 'Hibernate PC',
    description: 'Hibernate after delay (save power)',
    color: 'sleep',
    defaultParams: { delay: 5, unit: 'minutes' },
    params: [
      { key: 'delay', label: 'After', type: 'number', min: 0 },
      {
        key: 'unit', label: 'Unit', type: 'select',
        options: [
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' }
        ]
      }
    ]
  }
};

// ── Block Data Factory ───────────────────────────────────────
let _idCounter = 0;

export function generateBlockId() {
  return `blk-${Date.now()}-${++_idCounter}`;
}

export function createBlock(type) {
  const def = BLOCK_TYPES[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  return {
    id: generateBlockId(),
    type,
    params: { ...def.defaultParams }
  };
}

// ── Palette Block Renderer ───────────────────────────────────
export function renderPaletteBlock(typeDef) {
  const el = document.createElement('div');
  el.className = 'palette-block';
  el.setAttribute('data-type', typeDef.type);
  el.setAttribute('draggable', 'true');

  el.innerHTML = `
    <span class="block-icon">${esc(typeDef.icon)}</span>
    <div class="block-info">
      <div class="block-label">${esc(typeDef.label)}</div>
      <div class="block-desc">${esc(typeDef.description)}</div>
    </div>
  `;
  return el;
}

// ── Workflow Block Renderer ──────────────────────────────────
export function renderWorkflowBlock(block, index) {
  const def = BLOCK_TYPES[block.type];
  if (!def) return null;

  const el = document.createElement('div');
  el.className = 'workflow-block';
  el.setAttribute('data-block-id', block.id);
  el.setAttribute('data-type', block.type);

  // Build parameter fields
  const paramsHtml = def.params.map(p => buildParamField(p, block.params)).join('');

  el.innerHTML = `
    <div class="drag-handle" title="Drag to reorder">⠿</div>
    <div class="block-step-number">${String(index + 1).padStart(2, '0')}</div>
    <div class="block-stripe ${block.type}"></div>
    <div class="block-content">
      <div class="block-header">
        <span class="block-icon">${esc(def.icon)}</span>
        <span class="block-type-label">${esc(def.label)}</span>
      </div>
      <div class="block-params">${paramsHtml}</div>
    </div>
    <div class="block-actions">
      <button class="block-action-btn duplicate" title="Duplicate">📋</button>
      <button class="block-action-btn delete" title="Delete">✕</button>
    </div>
  `;

  return el;
}

// ── Parameter Field Builder ──────────────────────────────────
function buildParamField(paramDef, params) {
  const value = params[paramDef.key] ?? '';
  const key = esc(String(paramDef.key));
  let inputHtml;

  switch (paramDef.type) {
    case 'text':
      inputHtml = `<input type="text" data-param="${key}"
        value="${esc(String(value))}"
        placeholder="${esc(String(paramDef.placeholder || ''))}"
        spellcheck="false" />`;
      break;

    case 'number':
      inputHtml = `<input type="number" data-param="${key}"
        value="${esc(String(value))}"
        min="${esc(String(paramDef.min ?? ''))}" max="${esc(String(paramDef.max ?? ''))}" />`;
      break;

    case 'datetime-local':
      inputHtml = `<input type="datetime-local" data-param="${key}"
        value="${esc(String(value))}" />`;
      break;

    case 'select': {
      const opts = paramDef.options.map(o =>
        `<option value="${esc(String(o.value))}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      inputHtml = `<select data-param="${key}">${opts}</select>`;
      break;
    }

    case 'checkbox':
      inputHtml = `<input type="checkbox" data-param="${key}" ${value ? 'checked' : ''} />`;
      break;

    case 'directory':
      inputHtml = `
        <div class="param-dir-row">
          <input type="text" data-param="${key}"
            value="${esc(String(value))}"
            placeholder="${esc(String(paramDef.placeholder || 'Select directory...'))}"
            spellcheck="false" />
          <button class="btn btn-icon btn-sm browse-dir-btn"
            data-param="${key}" title="Browse" type="button">📂</button>
        </div>`;
      break;

    default:
      inputHtml = `<input type="text" data-param="${key}"
        value="${esc(String(value))}" />`;
  }

  return `
    <div class="block-param">
      <label>${esc(paramDef.label)}</label>
      ${inputHtml}
    </div>
  `;
}

// ── Helpers ──────────────────────────────────────────────────
function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
