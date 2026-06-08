// ============================================================
// Snowy Agent Orchestrator — Preload Script
// Bridges main process APIs to renderer via contextBridge
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Process management
  executeCommand: (params) => ipcRenderer.invoke('execute-command', params),
  sendInput: (params) => ipcRenderer.invoke('send-input', params),
  killProcess: (params) => ipcRenderer.invoke('kill-process', params),
  resizeProcess: (params) => ipcRenderer.invoke('resize-process', params),

  // Workflow persistence
  saveWorkflow: (params) => ipcRenderer.invoke('save-workflow', params),
  loadWorkflow: (params) => ipcRenderer.invoke('load-workflow', params),

  // File/Directory dialogs
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFileDialog: () => ipcRenderer.invoke('save-file-dialog'),

  // Event listeners for process output streaming
  onProcessOutput: (callback) => {
    ipcRenderer.on('process-output', (_event, data) => callback(data));
  },
  onProcessExit: (callback) => {
    ipcRenderer.on('process-exit', (_event, data) => callback(data));
  },
  onProcessError: (callback) => {
    ipcRenderer.on('process-error', (_event, data) => callback(data));
  },

  // Cleanup
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
