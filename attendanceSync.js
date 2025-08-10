/**
 * Google Apps Script: Student Database Synchronization
 * 
 * This script synchronizes student data from Google Form responses to a centralized
 * student database and tracks attendance for events. It automatically processes
 * new form submissions, updates existing student records, and maintains attendance
 * tracking.
 * 
 * Features:
 * - Automatic student database synchronization from form responses
 * - Attendance tracking for events
 * - SMS opt-in management
 * - Duplicate prevention and data deduplication
 * - Configurable field mapping between forms and database
 * 
 * @author Your Organization
 * @version 1.0.0
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Sheet names - update these to match your actual sheet names
  databaseSheetName: 'Student Database',    // Main student database sheet
  attendanceSheetName: 'Attendance',        // Attendance tracking sheet
  responseSheetNames: [                     // Form response sheets to process
    'Raw Attendance Data'
  ],
  
  // Form field mapping - maps form response headers to database columns
  // Only non-empty incoming values will overwrite existing database values
  // Join Date is special: only set on first insert, never overwritten
  fieldMap: {
    'Timestamp': 'Join Date',               // Only used on first insert
    'Full Name (First & Last)': 'Student Name',
    'Role': 'Role',
    'Panther ID': 'Panther ID',
    'Discord': 'Discord',
    'Email': 'Email',
    'Campus Email': 'Campus Email',
    'Phone Number ': 'Phone #',             // Note: trailing space if header has it
    'SMS Opt-In': 'SMS Opt-In'             // Checkbox normalized to Yes/? by code
  },

  // Priority order for matching existing students (most reliable first)
  matchKeys: ['Campus Email', 'Email', 'Phone #'],
  
  // Column added to form response sheets to track processed submissions
  processedFlagColumn: 'Processed',
  
  // Header name in response sheets for event ID
  eventIdHeader: 'Event ID Attended (Pre-Filled)'
};

// =============================================================================
// DEBUG CONFIGURATION
// =============================================================================

const DEBUG_ENABLED = true;

/**
 * Debug logging utility
 * Logs messages to both Apps Script Logger and a "Debug Log" sheet
 * @param {...any} args - Values to log
 */
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
    // Silently handle debug logging errors
  }
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Main synchronization function
 * Processes all form response sheets and updates student database
 * Also tracks attendance for events
 */
function syncStudentDatabase() {
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName(CONFIG.databaseSheetName);
  if (!db) {
    throw new Error(`Sheet "${CONFIG.databaseSheetName}" not found.`);
  }

  const dbData = readSheetAsObjects_(db);
  const dbIndex = buildIndex_(dbData.rows, CONFIG.matchKeys);

  // Process each response sheet
  CONFIG.responseSheetNames.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return; // Skip missing sheets
    
    ensureProcessedColumn_(sh, CONFIG.processedFlagColumn);
    const resp = readSheetAsObjects_(sh);
    const processedColIdx = resp.headers.indexOf(CONFIG.processedFlagColumn);

    // Process each unprocessed response row
    for (let r = 0; r < resp.rows.length; r++) {
      const row = resp.rows[r];
      const processed = (row[CONFIG.processedFlagColumn] || '').toString().toLowerCase() === 'yes';
      if (processed) continue;

      // Build normalized record according to field mapping
      const incoming = {};
      Object.entries(CONFIG.fieldMap).forEach(([respKey, dbKey]) => {
        incoming[dbKey] = normalizeFieldValue_(dbKey, row[respKey] ?? '');
      });

      // Determine match key from priority: Campus Email -> Email -> Phone #
      const keyValue = firstNonEmpty_([
        incoming['Campus Email'],
        incoming['Email'],
        incoming['Phone #']
      ]);
      const matchKey = keyValue ? inferMatchKey_(incoming) : null;

      if (!keyValue || !matchKey) {
        // No usable key, mark as processed to avoid reprocessing
        sh.getRange(resp.startRow + r, processedColIdx + 1).setValue('YES');
        continue;
      }

      // Try to find existing student record
      const idxKey = makeIndexKey_(matchKey, keyValue);
      const existingRowEntry = dbIndex.get(idxKey);

      let studentSaved = null; // Will hold the just-saved student record

      if (existingRowEntry) {
        // Update existing student record
        const { rowNumber, obj } = existingRowEntry;

        // Capture previous opt-in status for SMS logic
        const prevOpt = String(obj['SMS Opt-In'] || '').toLowerCase();
        const incomingOptYes = (incoming['SMS Opt-In'] === 'Yes');

        const updated = mergeRecords_(obj, incoming);

        // Force SMS opt-in to Yes if this submission opted in
        if (incomingOptYes) {
          updated['SMS Opt-In'] = 'Yes';
        }

        writeBackRow_(db, dbData.headers, rowNumber, updated);
        studentSaved = updated;

        // Send welcome SMS only if they just switched to Yes
        if (incomingOptYes && prevOpt !== 'yes') {
          const phone = updated['Phone #'];
          if (phone) {
            sendSms_(toE164_(phone), 'Thanks for opting in to Progsu SMS alerts! Cool events are coming your way. Reply STOP to opt out. Reply HELP for help.');
          }
        }
      } else {
        // Insert new student record
        const newObj = {};
        dbData.headers.forEach(h => newObj[h] = ''); // Initialize blank

        // Set mapped fields
        Object.keys(incoming).forEach(k => {
          newObj[k] = incoming[k];
        });

        // Set join date if not provided
        if (!newObj['Join Date']) {
          newObj['Join Date'] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy');
        }

        // Handle SMS Opt-In for new students
        const incomingOptYes = (incoming['SMS Opt-In'] === 'Yes');
        if (incomingOptYes) {
          newObj['SMS Opt-In'] = 'Yes';
        } else if (!newObj['SMS Opt-In']) {
          newObj['SMS Opt-In'] = '?';
        }

        appendRow_(db, dbData.headers, newObj);
        studentSaved = newObj;

        // Send welcome SMS for brand new opt-in students
        if (incomingOptYes) {
          const phone = newObj['Phone #'];
          if (phone) {
            sendSms_(toE164_(phone), 'Thanks for opting in to Progsu SMS alerts! Cool events are coming your way. Reply STOP to opt out. Reply HELP for help.');
          }
        }
      }

      // =============================================================================
      // ATTENDANCE TRACKING
      // =============================================================================
      
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

      // Mark this response row as processed
      sh.getRange(resp.startRow + r, processedColIdx + 1).setValue('YES');
    }
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Read sheet data as structured objects with headers and rows
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to read
 * @returns {Object} Object containing headers, rows, and start row information
 */
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

/**
 * Ensure a processed column exists in the sheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to modify
 * @param {string} colName - Name of the column to ensure exists
 */
function ensureProcessedColumn_(sheet, colName) {
  const data = readSheetAsObjects_(sheet);
  if (!data.headers.includes(colName)) {
    sheet.insertColumnAfter(data.headers.length); // Add at end
    sheet.getRange(1, data.headers.length + 1).setValue(colName);
  }
}

/**
 * Build an index for fast student lookup
 * @param {Array} rows - Array of student objects
 * @param {Array} matchKeys - Array of key names to index on
 * @returns {Map} Index map for fast lookups
 */
function buildIndex_(rows, matchKeys) {
  const idx = new Map();
  rows.forEach((obj, i) => {
    const keyName = inferMatchKey_(obj, matchKeys);
    const keyVal = firstNonEmpty_([
      obj['Campus Email'], 
      obj['Email'], 
      normalizeFieldValue_('Phone #', obj['Phone #'])
    ]);
    if (keyName && keyVal) {
      idx.set(makeIndexKey_(keyName, keyVal), { rowNumber: i + 2, obj });
    }
  });
  return idx;
}

/**
 * Infer which match key to use for a given object
 * @param {Object} obj - Object to analyze
 * @param {Array} keys - Array of possible keys
 * @returns {string|null} The first non-empty key found, or null
 */
function inferMatchKey_(obj, keys = CONFIG.matchKeys) {
  for (const k of keys) {
    const v = obj[k];
    if (v && String(v).trim() !== '') return k;
  }
  return null;
}

/**
 * Create a unique index key from key name and value
 * @param {string} keyName - Name of the key
 * @param {string} keyVal - Value of the key
 * @returns {string} Unique index key
 */
function makeIndexKey_(keyName, keyVal) {
  const v = String(keyVal).toLowerCase();
  return `${keyName}::${v}`;
}

/**
 * Find first non-empty value in array
 * @param {Array} arr - Array to search
 * @returns {string} First non-empty value, or empty string
 */
function firstNonEmpty_(arr) {
  for (const v of arr) {
    if (v && String(v).trim() !== '') return v;
  }
  return '';
}

/**
 * Normalize field values based on field type
 * @param {string} dbKey - Database column name
 * @param {any} value - Raw value to normalize
 * @returns {string} Normalized value
 */
function normalizeFieldValue_(dbKey, value) {
  if (!value) {
    if (dbKey === 'SMS Opt-In') return ''; // Leave blank to avoid overwriting existing
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

/**
 * Merge incoming data with existing record
 * @param {Object} existing - Existing record
 * @param {Object} incoming - Incoming data
 * @returns {Object} Merged record
 */
function mergeRecords_(existing, incoming) {
  const merged = { ...existing };
  Object.keys(incoming).forEach(k => {
    if (k === 'Join Date') return; // Do not overwrite join date
    const newVal = incoming[k];
    if (newVal !== '' && newVal !== null && newVal !== undefined) {
      merged[k] = newVal;
    }
  });
  return merged;
}

/**
 * Write object data back to a sheet row
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {Array} headers - Column headers
 * @param {number} rowNumber - Row number to write to
 * @param {Object} obj - Data object to write
 */
function writeBackRow_(sheet, headers, rowNumber, obj) {
  const row = headers.map(h => obj[h] ?? '');
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

/**
 * Append a new row to a sheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {Array} headers - Column headers
 * @param {Object} obj - Data object to append
 */
function appendRow_(sheet, headers, obj) {
  const row = headers.map(h => obj[h] ?? '');
  sheet.appendRow(row);
}

// =============================================================================
// ATTENDANCE TRACKING FUNCTIONS
// =============================================================================

/**
 * Safely get a value from a response row by trying multiple header variants
 * @param {Object} rowObj - Response row object
 * @param {Array} headers - Array of possible header names
 * @returns {string} Found value or empty string
 */
function getValueByHeader_(rowObj, headers) {
  for (const h of headers) {
    for (const key of Object.keys(rowObj)) {
      if (String(key).trim().toLowerCase() === String(h).trim().toLowerCase()) {
        const v = rowObj[key];
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          return String(v).trim();
        }
      }
    }
  }
  return '';
}

/**
 * Append attendance row to attendance sheet
 * Attendance columns (A-J): Event ID | Event Date | Location | Public Event Title | 
 * Student Name | Role | Panther ID | Discord | Email | Notes
 * Only writes Event ID and Campus Email to preserve formulas in other columns
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Attendance sheet
 * @param {string} eventId - Event identifier
 * @param {Object} student - Student object
 */
function appendAttendanceRow_(sheet, eventId, student) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headersLC = headerRow.map(h => String(h).trim().toLowerCase());

  const colEventId = headersLC.indexOf('event id') + 1;        // 1-based
  const colCampusEmail = headersLC.indexOf('campus email') + 1; // 1-based

  if (colEventId < 1 || colCampusEmail < 1) {
    debug_('ATTENDANCE ERROR -> Missing "Event ID" or "Campus Email" header. Headers:', headerRow);
    throw new Error('Attendance sheet must have headers "Event ID" and "Campus Email".');
  }

  const nextRow = sheet.getLastRow() + 1;
  const campusEmailVal = (student['Campus Email'] || '').toLowerCase().trim();

  debug_('ATTENDANCE INTENT -> nextRow=', nextRow, ' colEventId=', colEventId, 
         ' colCampusEmail=', colCampusEmail, ' eventId=', eventId, ' campusEmailVal=', campusEmailVal);

  if (eventId) sheet.getRange(nextRow, colEventId).setValue(eventId);
  if (campusEmailVal) sheet.getRange(nextRow, colCampusEmail).setValue(campusEmailVal);

  SpreadsheetApp.flush();
  debug_('ATTENDANCE WROTE -> row=', nextRow);
}

/**
 * Check if attendance record already exists
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Attendance sheet
 * @param {string} eventId - Event identifier
 * @param {string} campusEmailLower - Campus email (lowercase)
 * @returns {boolean} True if attendance already exists
 */
function hasAttendance_(sheet, eventId, campusEmailLower) {
  if (!eventId || !campusEmailLower) return false;

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headersLC = headerRow.map(h => String(h).trim().toLowerCase());

  const colEventId = headersLC.indexOf('event id');       // 0-based in values array
  const colCampusEmail = headersLC.indexOf('campus email'); // 0-based

  if (colEventId < 0 || colCampusEmail < 0) {
    debug_('ATTENDANCE DEDUPE WARN -> Missing headers. Headers:', headerRow);
    return false; // Don't block append if we can't dedupe
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { // Skip header
    const existingEventId = String(data[i][colEventId] || '').trim();
    const existingCampusEmail = String(data[i][colCampusEmail] || '').trim().toLowerCase();
    if (existingEventId === eventId && existingCampusEmail === campusEmailLower) {
      debug_('ATTENDANCE DEDUPE -> Found existing match at row', i + 1);
      return true;
    }
  }
  return false;
}

// =============================================================================
// USER INTERFACE
// =============================================================================

/**
 * Add custom menu to spreadsheet
 * Creates a "Student Sync" menu with sync functionality
 */
function onOpenStudentSync_() {
  SpreadsheetApp.getUi()
    .createMenu('Student Sync')
    .addItem('Sync now', 'syncStudentDatabase')
    .addToUi();
}
