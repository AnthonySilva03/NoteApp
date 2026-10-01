// jQuery and other libraries are loaded via script tags in index.html
// No Node.js requires needed - we use the secure electronAPI from preload
var currentNote = undefined;
var lastSelector = undefined;
var db;
var dbName;
var syncHandler;

// starter suggestions, merged with the topics and tags used by saved notes
var DEFAULT_LANGUAGES = ["javascript", "html", "css", "bootstrap", "jquery", "node.js", "java"];
var DEFAULT_TAGS = ["string", "example", "object", "array", "regexp", "loop"];

$(async function () {
  window.codemirror1 = CodeMirror($("#code").get(0), {
    value: "",
    mode: "javascript",
    lineNumbers: true,
    styleActiveLine: true,
    matchBrackets: true,
    theme: "material-darker",
  });

  window.quill = new Quill("#editor", {
    theme: "snow",
  });

  var config = await window.electronAPI.getConfig();
  dbName = config.dbName;
  db = new PouchDB(dbName);
  startSync(config.remoteCouch);

  await dbDefaults();
  renderLanguages();
  renderTags();
});

$("#tags").on("input", syncCheckboxes);

//live sync with CouchDB, if one is configured.
//Cancels any sync already running, so it can be called again after settings change.
function startSync(remote) {
  if (syncHandler) {
    syncHandler.cancel();
    syncHandler = undefined;
  }
  if (!remote || !remote.url) {
    console.log("No remote CouchDB configured; working offline only");
    return;
  }
  var remoteDB = new PouchDB(remote.url.replace(/\/$/, "") + "/" + dbName, {
    auth: { username: remote.username, password: remote.password }
  });
  syncHandler = db.sync(remoteDB, {
    live: true,
    retry: true
  }).on('change', function (change) {
    console.log("Sync " + change.direction + ": " + change.change.docs.length + " doc(s)");
    if (change.direction === "pull") {
      renderLanguages();
      renderTags();
    }
  }).on('error', function (err) {
    console.log("Couldn't sync with remote database", err);
  });
}

// creates index's to query by language and tags,
// and lowercases any notes saved before search became case-insensitive
async function dbDefaults() {
  try {
    await db.createIndex({ index: { fields: ["language"] } });
    await db.createIndex({ index: { fields: ["tags"] } });
    await lowercaseExistingNotes();
  } catch (err) {
    console.log(err);
  }
}

async function lowercaseExistingNotes() {
  var result = await db.allDocs({ include_docs: true });
  var changed = [];
  result.rows.forEach(function (row) {
    var doc = row.doc;
    if (doc._id.startsWith("_design/")) return;
    var language = (doc.language || "").toLowerCase();
    var tags = normalizeTags(doc.tags || []);
    if (language !== (doc.language || "") || JSON.stringify(tags) !== JSON.stringify(doc.tags || [])) {
      doc.language = language;
      doc.tags = tags;
      changed.push(doc);
    }
  });
  if (changed.length) {
    await db.bulkDocs(changed);
    console.log("Lowercased topics/tags on " + changed.length + " note(s)");
  }
}

//returns the defaults plus every value of `field` used by saved notes, sorted.
//Built from the notes themselves so it stays in sync across devices.
//(Map/reduce views would need eval, which the page's CSP blocks.)
async function listValues(field, defaults) {
  var result = await db.find({ selector: { _id: { $gt: null } }, fields: [field] });
  var values = new Set(defaults);
  result.docs.forEach(function (doc) {
    [].concat(doc[field] || []).forEach(function (v) {
      if (v) values.add(v);
    });
  });
  return Array.from(values).sort();
}

//rebuilds the topic suggestions
async function renderLanguages() {
  try {
    var languages = await listValues("language", DEFAULT_LANGUAGES);
    var fragment = document.createDocumentFragment();
    languages.forEach(function (lang) {
      var opt = document.createElement('option');
      opt.value = lang;
      fragment.appendChild(opt);
    });
    $("#language-list").empty().append(fragment);
  } catch (err) {
    console.log(err);
  }
}

//rebuilds the tag checkboxes
async function renderTags() {
  try {
    var tags = await listValues("tags", DEFAULT_TAGS);
    var sel = document.getElementById("tag_selector");
    if (!sel) {
      sel = document.createElement("div");
      sel.id = "tag_selector";
      $("#side-bar").append(sel);
    }
    var fragment = document.createDocumentFragment();
    tags.forEach(function (tag) {
      var checkbox = document.createElement('input');
      checkbox.type = "checkbox";
      checkbox.id = "tag-" + tag;
      checkbox.value = tag;
      addCheckboxListener(checkbox);
      var lab = document.createElement('label');
      lab.htmlFor = checkbox.id;
      lab.className = "container_checkbox";
      lab.textContent = tag;
      lab.appendChild(checkbox);
      fragment.appendChild(lab);
    });
    $(sel).empty().append(fragment);
    syncCheckboxes();
  } catch (err) {
    console.log(err);
  }
}

//ticks the checkboxes for the tags typed in the tags field
function syncCheckboxes() {
  var tags = getTags();
  $('#tag_selector input[type="checkbox"]').each(function () {
    this.checked = tags.includes(this.value);
  });
}

function addCheckboxListener(checkbox) {
  checkbox.addEventListener('change', (event) => {
    var val = checkbox.value;
    var tags = getTags();
    if (event.target.checked) {
      if (!tags.includes(val)) tags.push(val);
    } else if (tags.includes(val)) {
      tags.splice(tags.indexOf(val), 1);
    }
    $("#tags").val(tags.join(" "));
  });
}

$("#findNote").on("click", () => {
  var selector = {};
  var lang = $("#language").val().trim().toLowerCase();
  var tags = getTags();
  if (lang) selector.language = lang;
  if (tags.length) selector.tags = { $in: tags };
  if (!lang && !tags.length) selector._id = { $gt: null };  // list all notes
  findNotes(selector);
});

async function findNotes(selector) {
  lastSelector = selector;
  try {
    var result = await db.find({ selector: selector });
    show(result.docs);
    showMessage(result.docs.length ? "" : "No notes found");
  } catch (err) {
    console.log(err);
    showMessage("Search failed: " + err.message);
  }
}

//re-runs the last search so the table reflects adds/edits/deletes
function refreshResults() {
  if (lastSelector) findNotes(lastSelector);
}

function show(docs) {
  var table = document.createElement("table");
  table.className = "table table-dark table-striped";
  table.id = "tbl";
  var header = table.insertRow();
  var th = document.createElement("th");
  th.textContent = "Title";
  header.appendChild(th);

  docs.forEach(function (doc) {
    var cell = table.insertRow().insertCell();
    cell.className = "pointer";
    cell.dataset.id = doc._id;
    cell.textContent = doc.title || "(untitled)";
    cell.addEventListener("click", displayNote);
  });

  $("#noteTable").empty().append(table);
}

function displayNote() {
  db.get(this.dataset.id).then(function (doc) {
    currentNote = doc;
    $("#language").val(doc.language);
    $("#title").val(doc.title);
    $("#tags").val((doc.tags || []).join(" "));
    quill.setContents(doc.notes || []);
    codemirror1.setValue(doc.examples || "");
    syncCheckboxes();
  }).catch(function (err) {
    console.log(err);
    showMessage("Couldn't open note: " + err.message);
  });
}

$("#addNote").on("click", () => {
  addNote();
});

$("#clearNote").on("click", () => {
  clearNote();
});

$("#deleteNote").on("click", async () => {
  if (currentNote == undefined) {
    showMessage("No note to delete");
    return;
  }
  try {
    var doc = await db.get(currentNote._id);
    await db.remove(doc);
    clearNote();
    showMessage("Note deleted");
    refreshResults();
    renderLanguages();
    renderTags();
    var result = await window.electronAPI.deleteNoteBackup(doc._id);
    if (!result.success) console.error('Failed to delete backup:', result.error);
  } catch (err) {
    console.log(err);
    showMessage("Couldn't delete note: " + err.message);
  }
});

async function addNote() {
  try {
    var note;
    if (currentNote == undefined) {
      note = updateNote({});
      var result = await db.post(note);
      note._id = result.id;
    } else {
      note = updateNote(await db.get(currentNote._id));
      await db.put(note);
    }
    clearNote();
    showMessage("Note saved");
    refreshResults();
    renderLanguages();
    renderTags();
    saveToFile(note);
  } catch (err) {
    console.log(err);
    showMessage("Couldn't save note: " + err.message);
  }
}

//copies the form values onto a note doc
function updateNote(doc) {
  doc.language = $("#language").val().trim().toLowerCase();
  doc.title = $("#title").val().trim();
  doc.tags = getTags();
  doc.notes = quill.getContents();
  doc.examples = codemirror1.getValue();
  return doc;
}

async function saveToFile(note) {
  const result = await window.electronAPI.saveNoteBackup(JSON.parse(JSON.stringify(note)));
  if (result.success) {
    console.log("Backup saved to " + result.path);
  } else {
    console.error('Failed to save backup:', result.error);
  }
}

//clears all inputs
function clearNote() {
  $('#side-bar input[type="text"]').val("");
  syncCheckboxes();
  window.codemirror1.setValue("");
  // Quill v2: use setContents with empty delta instead of deprecated setText
  quill.setContents([]);
  currentNote = undefined;
}

function showMessage(text) {
  $("#demo").text(text);
}

//lowercased, de-duplicated tags from the tags field
function getTags() {
  return normalizeTags($("#tags").val().trim().split(/\s+/));
}

function normalizeTags(tags) {
  var lower = tags.filter(Boolean).map(function (t) { return t.toLowerCase(); });
  return Array.from(new Set(lower));
}

//settings dialog: CouchDB sync options. The stored password is never shown;
//leaving the field blank keeps it.
$("#openSettings").on("click", async () => {
  var s = await window.electronAPI.getSettings();
  $("#syncEnabled").prop("checked", s.enabled);
  $("#couchUrl").val(s.url);
  $("#couchUser").val(s.username);
  $("#couchPassword").val("");
  $("#passwordHint").text(s.hasPassword ? "A password is saved. Leave blank to keep it." : "");
  $("#settingsError").text("");
  document.getElementById("settingsDialog").showModal();
});

$("#cancelSettings").on("click", () => {
  document.getElementById("settingsDialog").close();
});

$("#settingsForm").on("submit", async (event) => {
  event.preventDefault();
  var result = await window.electronAPI.saveSettings({
    enabled: $("#syncEnabled").prop("checked"),
    url: $("#couchUrl").val(),
    username: $("#couchUser").val(),
    password: $("#couchPassword").val()
  });
  if (!result.success) {
    $("#settingsError").text(result.error);
    return;
  }
  $("#couchPassword").val("");
  document.getElementById("settingsDialog").close();
  var config = await window.electronAPI.getConfig();
  startSync(config.remoteCouch);
  showMessage(config.remoteCouch ? "Sync settings saved" : "Sync turned off");
});
