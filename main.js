const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');

// Loads config.json from the user data folder, falling back to the project folder.
// config.json is git-ignored; see config.example.json for the format.
async function loadConfig() {
  const candidates = [
    path.join(app.getPath('userData'), 'config.json'),
    path.join(__dirname, 'config.json')
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Failed to read ' + file + ':', err);
    }
  }
  return {};
}

function backupDir() {
  return path.join(app.getPath('userData'), 'NotesBackUp');
}

ipcMain.handle('get-config', async () => {
  const config = await loadConfig();
  return {
    dbName: config.dbName || 'programming',
    remoteCouch: config.remoteCouch || null
  };
});

// Backups are named after the note's _id. The filename is built here so the
// renderer can never choose an arbitrary path.
function backupPath(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safe) throw new Error('Note has no id');
  return path.join(backupDir(), safe + '.json');
}

// Writes a JSON backup of a note.
ipcMain.handle('save-note-backup', async (event, note) => {
  try {
    const filePath = backupPath(note._id);
    await fs.mkdir(backupDir(), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(note, null, 2));
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Removes a deleted note's backup.
ipcMain.handle('delete-note-backup', async (event, id) => {
  try {
    await fs.unlink(backupPath(id));
    return { success: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { success: true };
    return { success: false, error: err.message };
  }
});

function createWindow() {
  // Create the browser window with security best practices.
  const win = new BrowserWindow({
    width: 1000,
    height: 850,
    webPreferences: {
      nodeIntegration: false,        // Disable Node.js in renderer
      contextIsolation: true,        // Enable context isolation (required)
      sandbox: true,                 // Enable sandboxing
      preload: path.join(__dirname, 'preload.js')  // Preload script for secure API exposure
    }
  });

  // Load the index.html of the app.
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
