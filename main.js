const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const fs = require('fs').promises;
const path = require('path');

// Settings live in <userData>/settings.json. The CouchDB password is encrypted
// with safeStorage (DPAPI on Windows), so only this Windows user can read it.
//   { dbName, remoteCouch: { enabled, url, username, passwordEnc } }
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Failed to read ' + file + ':', err);
    return null;
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
}

function encrypt(password) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Password encryption is not available on this system');
  }
  return safeStorage.encryptString(password).toString('base64');
}

function decrypt(passwordEnc) {
  if (!passwordEnc) return '';
  try {
    return safeStorage.decryptString(Buffer.from(passwordEnc, 'base64'));
  } catch (err) {
    console.error('Failed to decrypt CouchDB password:', err);
    return '';
  }
}

// Loads settings.json. On first run, imports the old plain-text config.json
// (from userData or the project folder) and encrypts its password.
async function loadSettings() {
  const settings = await readJson(settingsFile());
  if (settings) return settings;

  const legacy = await readJson(path.join(app.getPath('userData'), 'config.json')) ||
                 await readJson(path.join(__dirname, 'config.json'));
  const imported = { dbName: 'programming', remoteCouch: null };
  if (legacy) {
    imported.dbName = legacy.dbName || imported.dbName;
    const remote = legacy.remoteCouch;
    if (remote && remote.url) {
      imported.remoteCouch = {
        enabled: true,
        url: remote.url,
        username: remote.username || '',
        passwordEnc: remote.password ? encrypt(remote.password) : ''
      };
    }
    await writeSettings(imported);
    console.log('Imported config.json into encrypted settings.json; config.json can now be deleted');
  }
  return imported;
}

// Plain http is only allowed for this machine, so a password is never sent
// unencrypted over the network.
function validateCouchUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Enter a full URL, e.g. http://127.0.0.1:5984');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local)) {
    return parsed.origin;
  }
  throw new Error('Use https:// for a CouchDB server on another machine');
}

function backupDir() {
  return path.join(app.getPath('userData'), 'NotesBackUp');
}

// Used by the renderer to open the database and start sync.
ipcMain.handle('get-config', async () => {
  const settings = await loadSettings();
  const remote = settings.remoteCouch;
  return {
    dbName: settings.dbName || 'programming',
    remoteCouch: remote && remote.enabled && remote.url ? {
      url: remote.url,
      username: remote.username,
      password: decrypt(remote.passwordEnc)
    } : null
  };
});

// Used by the settings dialog. Never returns the password itself.
ipcMain.handle('get-settings', async () => {
  const remote = (await loadSettings()).remoteCouch || {};
  return {
    enabled: !!remote.enabled,
    url: remote.url || 'http://127.0.0.1:5984',
    username: remote.username || '',
    hasPassword: !!remote.passwordEnc
  };
});

// Saves the sync settings. A blank password keeps the stored one.
ipcMain.handle('save-settings', async (event, input) => {
  try {
    const settings = await loadSettings();
    const previous = settings.remoteCouch || {};
    const enabled = !!input.enabled;
    const url = String(input.url || '').trim();
    settings.remoteCouch = {
      enabled,
      url: enabled || url ? validateCouchUrl(url) : '',
      username: String(input.username || '').trim(),
      passwordEnc: input.password ? encrypt(String(input.password)) : (previous.passwordEnc || '')
    };
    await writeSettings(settings);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
