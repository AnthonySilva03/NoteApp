// Preload script - runs before the page loads.
// It is sandboxed, so it can't use fs; file access goes through IPC to main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Returns { dbName, remoteCouch } from config.json
  getConfig: () => ipcRenderer.invoke('get-config'),
  // Saves a JSON backup of a note to the app's NotesBackUp folder
  saveNoteBackup: (note) => ipcRenderer.invoke('save-note-backup', note),
  // Removes a deleted note's backup
  deleteNoteBackup: (id) => ipcRenderer.invoke('delete-note-backup', id)
});
