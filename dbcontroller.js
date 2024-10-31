//Jquery
let $ = require("jquery");
const fs = require('fs');

//Quill
//var options = { theme: snow};
//var editor = new Quill('#editor', options);
const Quill = require("quill");

//PouchDB
var dbname = "notesbackup";
var db = new PouchDB(dbname);
var remoteCouch = "http://admin:Darwin85$@127.0.0.1:5984/" + dbname;
var remoteDB = new PouchDB(remoteCouch);
var opts = {
  live: true,
};
var sync = db.sync(dbname, opts);

var currentNote = undefined;

db.sync(remoteDB, {
  live: true
}).on('change', function (change) {
  console.log(" yo, something changed!" + change.change);
}).on('error', function (err) {
  console.log(" DIDNT WORK!! Couldn't update database" + err);
});

//check db doc count
db.info()
  .then(function (result) {
    console.log("the count is " + result.doc_count);
    if (result.doc_count == 0) {
      dbDefaults();
    }
  })
  .catch(function (err) {
    console.log(err);
  });

// creates index's to query by language and tags
// and local docs for languages and tags
function dbDefaults() {
  db.createIndex({
    index: {
      fields: ["language"],
    },
  });
  db.createIndex({
    index: {
      fields: ["tags"],
    },
  });
  db.put({
    _id: "_local/languages",
    language: [
      "javascript",
      "html",
      "css",
      "bootstrap",
      "jquery",
      "node.js",
      "java",
    ],
  });
  db.put({
    _id: "_local/tags",
    tags: ["string", "example", "object", "array", "regexp", "loop"],
  });
}

//create codemirror and quill
$(document).ready(function () {
  var str = "//Code Example \n" + " function foo()     {  var x=1; return x; }";
  window.codemirror1 = CodeMirror($("#code").get(0), {
    value: str,
    mode: "python",
    lineNumbers: true,
    styleActiveLine: true,
    matchBrackets: true,
    theme: "material-darker",
  });

  window.quill = new Quill("#editor", {
    theme: "snow",
  });

  findDisplay();
});

function findDisplay() {
  db.get('_local/languages').then(function (doc) {
    var fragment = document.createDocumentFragment();

    doc.language.forEach(function (lang, index) {
      var opt = document.createElement('option');
      opt.value = lang;
      fragment.appendChild(opt);
    });
    $("#language-list").append(fragment);
  }).catch(function (err) {
    console.log(err);
  });

  db.get('_local/tags').then(function (doc) {
    var sel = document.createElement("div");
    sel.id = "tag_selector";
    var fragment = document.createDocumentFragment();
    doc.tags.forEach(function (tag, index) {
      var checkbox = document.createElement('input');
      checkbox.type = "checkbox";
      checkbox.id = tag;
      checkbox.value = tag;
      addCheckboxListener(checkbox);
      var lab = document.createElement('label');
      lab.for = tag;
      lab.innerHTML = tag;
      lab.class = "container_checkbox";
      lab.appendChild(checkbox);
      fragment.appendChild(lab);
    });
    sel.appendChild(fragment);
    $("#side-bar").append(sel);
  }).catch(function (err) {
    console.log(err);
  });
}

function addCheckboxListener(checkbox) {
  checkbox.addEventListener('change', (event) => {
    var val = checkbox.value;
    var tags = getTags();
    if (event.target.checked) {
      $("#tags").val(tags.join(" ") + " " + val);
      console.log(val + ' is checked');
    } else {
      if (tags.includes(val)) {
        tags.splice(tags.indexOf(val), 1);
        $("#tags").val(tags.join(" "));
      }
      console.log(val + ' not checked');
    }
  });
}

$("#findNote").on("click", () => {
  var lang = document.getElementById("language");
  var tags = document.getElementById("tags");
  var foundNotes = undefined;
  if (lang.value && tags.value) {
    db.find({
      selector: {
        language: lang.value,
        tags: {
          $in: getTags()
        }
      },
    }).then(function (doc) {
      // doc.rows.forEach(function (i) {console.log(i)});
      console.log(doc.docs);
      foundNotes = doc.docs;
      show(doc);
      // readJsonFile();
    });
  } else if (lang.value) {
    db.find({
      selector: {
        language: lang.value
      },
    }).then(function (doc) {
      // doc.rows.forEach(function (i) {console.log(i)});
      console.log(doc.docs);
      foundNotes = doc.docs;
      show(doc);
      // readJsonFile();
    });

  } else if (tags.value) {
    db.find({
      selector: {
        tags: {
          $in: getTags()
        }
      },
    }).then(function (doc) {
      // doc.rows.forEach(function (i) {console.log(i)});
      console.log(doc.docs);
      foundNotes = doc.docs;
      show(doc);
      // readJsonFile();
    });
  } else {
    console.log("couldnt find any notes");
  }
});

function readJsonFile() {
  // Read users.json file 
  fs.readFile("C:/Users/silva/Documents/programming/NotesBackUp/users.json", function (err, data) {

    // Check for errors 
    if (err) throw err;

    // Converting to JSON 
    const users = JSON.parse(data);

    console.log(users); // Print users 
  });
}

function show(doc) {
  // Create table element
  const tbl = document.getElementById('notesTables');
  if (tbl && tbl.parentNode) {
      tbl.parentNode.removeChild(table);
  }

  var table = document.createElement('table');
  table.className = 'table table-dark table-striped';
  table.border = '2';
  table.id = 'notesTable';
  
  // Create table header
  var headerRow = document.createElement('tr');
  var headerCell = document.createElement('th');
  headerCell.textContent = 'Title';
  headerRow.appendChild(headerCell);
  table.appendChild(headerRow);
  
  // Populate table rows
  doc.docs.forEach(function (item) {
  var row = document.createElement('tr');
  var cell = document.createElement('td');
  cell.className = 'pointer';
  cell.id = item._id;
  cell.textContent = item.title;
  // Add event listener to the row
  cell.addEventListener("click", displayNote);
  row.appendChild(cell);
  table.appendChild(row);
  });
  
  // Append the table to the specified element
  document.getElementById("noteTable").appendChild(table);
  }

function displayNote() {
  db.get(this.id).then(function (doc) {
    currentNote = doc;
    $("#language").val(doc.language);
    $("#title").val(doc.title);
    $("#tags").val(doc.tags.join(" "));
    quill.setContents(doc.notes);
    codemirror1.setValue(doc.examples);
  });
}

$("#addNote").on("click", () => {
  addNote();
});

$("#clearNote").on("click", () => {
  clearNote();
});

$("#deleteNote").on("click", () => {
  if (currentNote == undefined) {
    document.getElementById("demo").innerHTML = "<h3> no note to delete </h3>";
  } else {
    db.get(currentNote._id).then(function (doc) {
      return db.remove(doc);
    }).then(function (result) {
      // handle result
    }).catch(function (err) {
      console.log(err);
    });
  }
  clearNote();
});

function dbUpdateSearchIndexs(note) {
  db.get('_local/languages').then(function (doc) {
    if (doc.language.includes(note.language.toLowerCase())) {
      console.log(note.language + " is included in index array");
    } else {
      doc.language.push(note.language.toLowerCase());
      db.put(doc);
      console.log("updated language index");
    }
  }).catch(function (err) {
    console.log(err);
  });

  db.get('_local/tags').then(function (doc) {
    var newTag = false;
    note.tags.forEach(function (i) {
      if (doc.tags.includes(i.toLowerCase())) {
        console.log(i + " is included in index array");
      } else {
        newTag = true;
        doc.tags.push(i.toLowerCase());
      }
    });
    if (newTag) {
      db.put(doc)
      console.log("updated Tags index");
    }
  }).catch(function (err) {
    console.log(err);
  });
}

function addNote() {
  if (currentNote == undefined) {
    var note = new Note();
    db.post(note);
    dbUpdateSearchIndexs(note);
    clearNote();
    saveToFile(note);
  } else {
    db.get(currentNote._id).then(function (doc) {
      db.put(updateNote(doc));
      dbUpdateSearchIndexs(doc);
      clearNote();
      saveToFile(doc);
    });
  }
}

function updateNote(doc) {
  doc.language = $("#language").val();
  doc.title = $("#title").val();
  doc.tags = getTags();
  doc.notes = quill.getContents();
  doc.examples = codemirror1.getValue();
  console.log(doc);
  return doc;
}

function saveToFile(note) {
  fs.writeFile("C:/Users/silva/Documents/programming/NotesBackUp/" + note.language + "_" + note.title + ".json", JSON.stringify(note), function (err) {
    if (err) {
      return console.log(err);
    }
    console.log("The file was saved!");
  });
}

function clearNote() {
  $('#side-bar input[type="text"]').val("");
  codemirror1.setValue("");
  quill.setText("");
  currentNote = undefined;
}

function Note() {
  this.language = $("#language").val();
  this.title = $("#title").val();
  this.tags = getTags();
  this.notes = quill.getContents();
  this.examples = codemirror1.getValue();
}

function getTags() {
  return $("#tags").val().trim().split(" ");
}