/***** CONFIG *****/
const CONFIG = {
  databaseSheetName: 'Student Database', // exact sheet name
  attendanceSheetName: 'Attendance',     // sheet that collects attendance
  responseSheetNames: [                  // sheets that receive Form responses
    'Raw Attendance Data',
    // Add any additional response tabs here. Missing tabs are skipped safely.
    'Interest Form Raw Data'
  ],
  eventIdHeader: 'Event ID Attended (Pre-Filled)',             // header name in your response tab for the event id


  // fieldAliases defines, for each database column, the acceptable response header names
  // that may appear in different forms/tabs. The first non-empty match is used.
  //
  // IMPORTANT:
  // - You can list aliases here even if a form does not collect them.
  // - If an alias is missing or blank in a submission, the existing DB value is preserved.
  // - Only non-empty incoming values overwrite existing ones.
  // - Join Date is set on first insert and never overwritten later.
  fieldAliases: {
    'Join Date': ['Timestamp', 'Join Date'],
    'Student Name': ['Full Name (First & Last)', 'Full Name', 'Name', 'Student Name'],
    'Role': ['Role'],
    'Panther ID': ['Panther ID', 'PantherID'],
    'Discord': ['Discord', 'Discord Handle'],
    'Email': ['Email', 'Personal Email'],
    'Campus Email': ['Campus Email', 'Campus Email Address', 'School Email'],
    'Phone #': ['Phone Number ', 'Phone Number', 'Phone', 'Phone #', 'Mobile'],
    'SMS Opt-In': ['SMS Opt-In', 'SMS Opt In', 'Text Opt-In', 'Text Opt In']
  },

  // priority order for matching an existing student
  matchKeys: ['Campus Email', 'Email', 'Phone #'],
  processedFlagColumn: 'Processed',       // added to each Form response tab
};

function hashForPassOnce() {
  const pass = 'Your-Strong-Passcode';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass);
  Logger.log(bytes.map(b => (b+256)%256).map(n => n.toString(16).padStart(2,'0')).join(''));
}

// Toggle debug
const DEBUG_ENABLED = true;

// Simple debug: logs to Logger and a "Debug Log" sheet
function debug_(...args) {
  try {
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (DEBUG_ENABLED) {
      Logger.log(msg);
      const ss = SpreadsheetApp.getActive();
      let sh = ss.getSheetByName('Debug Log');
      if (!sh) {
        sh = ss.insertSheet('Debug Log');
        sh.appendRow(['Timestamp', 'Message']);
      }
      sh.appendRow([new Date(), msg]);
    }
  } catch (e) {
    // swallow
  }
}
/***** ENTRY POINT *****/
function syncStudentDatabase() {
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName(CONFIG.databaseSheetName);
  if (!db) throw new Error(`Sheet "${CONFIG.databaseSheetName}" not found.`);

  const dbData = readSheetAsObjects_(db);
  const dbIndex = buildIndex_(dbData.rows, CONFIG.matchKeys);

  CONFIG.responseSheetNames.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return; // skip missing tabs
    ensureProcessedColumn_(sh, CONFIG.processedFlagColumn);

    const resp = readSheetAsObjects_(sh);
    const processedColIdx = resp.headers.indexOf(CONFIG.processedFlagColumn);

    for (let r = 0; r < resp.rows.length; r++) {
      const row = resp.rows[r];
      const processed = (row[CONFIG.processedFlagColumn] || '').toString().toLowerCase() === 'yes';
      if (processed) continue;

      // Build a normalized record using header aliases per DB column
      const incoming = {};
      Object.keys(CONFIG.fieldAliases).forEach((dbKey) => {
        const candidateHeaders = CONFIG.fieldAliases[dbKey] || [dbKey];
        const rawValue = getValueByHeader_(row, candidateHeaders);
        incoming[dbKey] = normalizeFieldValue_(dbKey, rawValue);
      });

      // Decide match key from priority: Campus Email -> Email -> Phone #
      const keyValue = firstNonEmpty_([
        incoming['Campus Email'],
        incoming['Email'],
        incoming['Phone #']
      ]);
      const matchKey = keyValue ? inferMatchKey_(incoming) : null;

      if (!keyValue || !matchKey) {
        // no usable key, mark processed to avoid reprocessing
        sh.getRange(resp.startRow + r, processedColIdx + 1).setValue('YES');
        continue;
      }

      // Try to find existing row
      const idxKey = makeIndexKey_(matchKey, keyValue);
      const existingRowEntry = dbIndex.get(idxKey);

      let studentSaved = null; // will hold the just-saved student record

if (existingRowEntry) {
  // Update existing
  const { rowNumber, obj } = existingRowEntry;

  // Capture old opt-in status
  const prevOpt = String(obj['SMS Opt-In'] || '').toLowerCase();
  const incomingOptYes = (incoming['SMS Opt-In'] === 'Yes');

  const updated = mergeRecords_(obj, incoming);

  // If this submission opted in, force Yes
  if (incomingOptYes) {
    updated['SMS Opt-In'] = 'Yes';
  }

  writeBackRow_(db, dbData.headers, rowNumber, updated);
  studentSaved = updated;

  // ✅ Send welcome SMS only if they just switched to Yes
  if (incomingOptYes && prevOpt !== 'yes') {
    const phone = updated['Phone #'];
    if (phone) {
      sendSms_(toE164_(phone), 'Thanks for opting in to Progsu SMS alerts! Cool events are coming your way. Reply STOP to opt out. Reply HELP for help.');
    }
  }
}
 else {
        // Insert new
        const newObj = {};
        dbData.headers.forEach(h => newObj[h] = ''); // init blank

        // Set mapped fields
        Object.keys(incoming).forEach(k => {
          newObj[k] = incoming[k];
        });

        if (!newObj['Join Date']) {
          newObj['Join Date'] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy');
        }

        // Handle SMS Opt-In
        const incomingOptYes = (incoming['SMS Opt-In'] === 'Yes');
        if (incomingOptYes) {
          newObj['SMS Opt-In'] = 'Yes';
        } else if (!newObj['SMS Opt-In']) {
          newObj['SMS Opt-In'] = '?';
        }

        appendRow_(db, dbData.headers, newObj);
        studentSaved = newObj;

        // ✅ Send welcome SMS for brand new opt-in
        if (incomingOptYes) {
          const phone = newObj['Phone #'];
          if (phone) {
            sendSms_(toE164_(phone), 'Thanks for opting in to Progsu SMS alerts! Cool events are coming your way. Reply STOP to opt out. Reply HELP for help.');
          }
        }
      }


      // -------- ATTENDANCE APPEND --------
      const attendanceSheet = ss.getSheetByName(CONFIG.attendanceSheetName);
      if (attendanceSheet && studentSaved) {
        // Be tolerant to header variants for Event ID
        const eventId = getValueByHeader_(row, [
          CONFIG.eventIdHeader, 'EventID', 'Event Id', 'Event', 'Workshop', 'Workshop/Event'
        ]);

        const campusEmailKey = (studentSaved['Campus Email'] || '').toLowerCase().trim();



        debug_('ATTENDANCE DEBUG -> eventId=', eventId, ' campusEmailKey=', campusEmailKey);


        if (eventId && campusEmailKey && !hasAttendance_(attendanceSheet, eventId, campusEmailKey)) {
          appendAttendanceRow_(attendanceSheet, eventId, studentSaved);
          debug_('ATTENDANCE APPENDED');
        } else {
          debug_('ATTENDANCE SKIPPED (missing eventId/campusEmail or duplicate)');
        }
      }
      // -----------------------------------

      // Mark this response row as processed
      sh.getRange(resp.startRow + r, processedColIdx + 1).setValue('YES');
    }
  });
}

/***** HELPERS *****/
function readSheetAsObjects_(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length === 0) return { headers: [], rows: [], startRow: 2 };
  const headers = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    headers.forEach((h, j) => obj[h] = values[i][j]);
    rows.push(obj);
  }
  return { headers, rows, startRow: 2 };
}

function ensureProcessedColumn_(sheet, colName) {
  const data = readSheetAsObjects_(sheet);
  if (!data.headers.includes(colName)) {
    sheet.insertColumnAfter(data.headers.length); // add at end
    sheet.getRange(1, data.headers.length + 1).setValue(colName);
  }
}

function buildIndex_(rows, matchKeys) {
  const idx = new Map();
  rows.forEach((obj, i) => {
    const keyName = inferMatchKey_(obj, matchKeys);
    const keyVal = firstNonEmpty_([obj['Campus Email'], obj['Email'], normalizeFieldValue_('Phone #', obj['Phone #'])]);
    if (keyName && keyVal) {
      idx.set(makeIndexKey_(keyName, keyVal), { rowNumber: i + 2, obj });
    }
  });
  return idx;
}

function inferMatchKey_(obj, keys = CONFIG.matchKeys) {
  for (const k of keys) {
    const v = obj[k];
    if (v && String(v).trim() !== '') return k;
  }
  return null;
}

function makeIndexKey_(keyName, keyVal) {
  const v = String(keyVal).toLowerCase();
  return `${keyName}::${v}`;
}

function firstNonEmpty_(arr) {
  for (const v of arr) {
    if (v && String(v).trim() !== '') return v;
  }
  return '';
}

function normalizeFieldValue_(dbKey, value) {
  if (!value) {
    if (dbKey === 'SMS Opt-In') return ''; // leave blank so we don't overwrite existing on updates
    return '';
  }
  let v = value;

  if (dbKey === 'Email' || dbKey === 'Campus Email') {
    v = String(v).trim().toLowerCase();
  }
  if (dbKey === 'Phone #') {
    v = String(v).replace(/[^\d]/g, '');
    if (v.length === 11 && v.startsWith('1')) v = v.slice(1);
  }
  if (dbKey === 'SMS Opt-In') {
    // Any non-empty checkbox value means they opted in
    return 'Yes';
  }
  return v;
}

function mergeRecords_(existing, incoming) {
  const merged = { ...existing };
  Object.keys(incoming).forEach(k => {
    if (k === 'Join Date') return; // do not overwrite join date
    const newVal = incoming[k];
    if (newVal !== '' && newVal !== null && newVal !== undefined) {
      merged[k] = newVal;
    }
  });
  return merged;
}

function writeBackRow_(sheet, headers, rowNumber, obj) {
  const row = headers.map(h => obj[h] ?? '');
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function appendRow_(sheet, headers, obj) {
  const row = headers.map(h => obj[h] ?? '');
  sheet.appendRow(row);
}

/***** ATTENDANCE HELPERS *****/
// Safely get a value from a response row by trying multiple header variants
function getValueByHeader_(rowObj, headers) {
  for (const h of headers) {
    for (const key of Object.keys(rowObj)) {
      if (String(key).trim().toLowerCase() === String(h).trim().toLowerCase()) {
        const v = rowObj[key];
        if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
      }
    }
  }
  return '';
}

// Attendance columns (A→J):
// Event ID | Event Date | Location | Public Event Title | Student Name | Role | Panther ID | Discord | Email | Notes
// Write ONLY Event ID and Email so formulas in other columns are preserved.
// Write ONLY Event ID and Campus Email so formulas in other columns stay untouched.
function appendAttendanceRow_(sheet, eventId, student) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headersLC = headerRow.map(h => String(h).trim().toLowerCase());

  const colEventId      = headersLC.indexOf('event id') + 1;        // 1-based
  const colCampusEmail  = headersLC.indexOf('campus email') + 1;    // 1-based

  if (colEventId < 1 || colCampusEmail < 1) {
    debug_('ATTENDANCE ERROR -> Missing "Event ID" or "Campus Email" header. Headers:', headerRow);
    throw new Error('Attendance sheet must have headers "Event ID" and "Campus Email".');
  }

  const nextRow = sheet.getLastRow() + 1;
  const campusEmailVal = (student['Campus Email'] || '').toLowerCase().trim();

  debug_('ATTENDANCE INTENT -> nextRow=', nextRow, ' colEventId=', colEventId, ' colCampusEmail=', colCampusEmail, ' eventId=', eventId, ' campusEmailVal=', campusEmailVal);

  if (eventId)        sheet.getRange(nextRow, colEventId).setValue(eventId);
  if (campusEmailVal) sheet.getRange(nextRow, colCampusEmail).setValue(campusEmailVal);

  SpreadsheetApp.flush();
  debug_('ATTENDANCE WROTE -> row=', nextRow);
}

function hasAttendance_(sheet, eventId, campusEmailLower) {
  if (!eventId || !campusEmailLower) return false;

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headersLC = headerRow.map(h => String(h).trim().toLowerCase());

  const colEventId     = headersLC.indexOf('event id');       // 0-based in values array
  const colCampusEmail = headersLC.indexOf('campus email');   // 0-based

  if (colEventId < 0 || colCampusEmail < 0) {
    debug_('ATTENDANCE DEDUPE WARN -> Missing headers. Headers:', headerRow);
    return false; // don't block append if we can't dedupe
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { // skip header
    const existingEventId     = String(data[i][colEventId] || '').trim();
    const existingCampusEmail = String(data[i][colCampusEmail] || '').trim().toLowerCase();
    if (existingEventId === eventId && existingCampusEmail === campusEmailLower) {
      debug_('ATTENDANCE DEDUPE -> Found existing match at row', i + 1);
      return true;
    }
  }
  return false;
}



/***** OPTIONAL: add a custom menu *****/
function onOpenStudentSync_() {
  SpreadsheetApp.getUi()
    .createMenu('Student Sync')
    .addItem('Sync now', 'syncStudentDatabase')
    .addToUi();
}

