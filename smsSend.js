/**
 * Google Apps Script — SMS Sending and Management System
 *
 * Overview
 * This script provides an SMS management layer for sending messages to students,
 * managing reusable templates, and handling audience selection for events. It
 * includes access control, passcode gating, rate limiting, and robust logging.
 *
 * Features
 * - Authentication and admin access control
 * - Passcode-gated UI actions (12h session TTL)
 * - Message templates with dynamic placeholders
 * - Bulk messaging to opted-in recipients
 * - Event-based audiences (attendees) and general audiences (all opted-in)
 * - Rate limiting and dry-run mode
 * - Logging with retry support for failures
 *
 * Prerequisites
 * - Twilio credentials and low-level send/log helpers configured in sms.js
 * - A "Student Database" sheet with opt-in and phone columns
 * - An "Attendance" sheet and an "Event Log" sheet for event workflows
 *
 * Section Index
 *  1) Access Control and Configuration
 *  2) Password Authentication Core
 *  3) Debug Helpers (auth)
 *  4) Utilities
 *  5) Message Templates
 *  6) UI Menus
 *  7) Core SMS Sending
 *  8) Audience Resolution and Event Info
 *  9) Sidebar RPC (UI bridge)
 * 10) Failure Retry and Misc
 */

// =============================================================================
// 1) ACCESS CONTROL AND CONFIGURATION
// =============================================================================

/**
 * Set SMS password from plaintext (run once to configure)
 * @param {string} plain - Plaintext password
 */
function setSmsPassFromPlaintext(plain) {
  const hex = sha256Hex_(String(plain));
  PropertiesService.getScriptProperties().setProperty('SMS_PANEL_PASS_SHA256', hex);
  Logger.log('Set SMS_PANEL_PASS_SHA256: ' + hex);
}

/**
 * Reset authentication session for testing
 */
function smsAuthResetMe() {
  PropertiesService.getUserProperties().deleteAllProperties();
}

/**
 * Debug authentication configuration
 */
function smsAuthDebug_() {
  const sp = PropertiesService.getScriptProperties();
  const up = PropertiesService.getUserProperties();
  const H = (sp.getProperty('SMS_PANEL_PASS_SHA256') || '').trim();
  
  Logger.log('Script hash length: %s', H.length);     // Must be 64
  Logger.log('Script hash (first 8): %s', H.slice(0, 8)); // Sanity peek
  Logger.log('User stored hash (first 8): %s', (up.getProperty('SMS_AUTH_HASH') || '').slice(0, 8));
  Logger.log('Needs pass? %s', uiNeedsPass());
}

/**
 * Test password hashing
 * @param {string} plain - Plaintext to hash
 */
function smsAuthHashTest_(plain) {
  Logger.log('Test hash: %s', sha256Hex_(String(plain)));
}

// Script properties and configuration helpers

/**
 * Get script property with default value
 * @param {string} k - Property key
 * @param {any} dft - Default value
 * @returns {any} Property value or default
 */
function getProp_(k, dft) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  return v !== null && v !== undefined && v !== '' ? v : dft;
}

/**
 * Check if dry run mode is enabled
 * @returns {boolean} True if dry run mode is active
 */
function isDryRun_() {
  return String(getProp_('SMS_DRY_RUN', 'false')).toLowerCase() === 'true';
}

/**
 * Get rate limiting delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
function rateDelayMs_() {
  const n = Number(getProp_('SMS_RATE_DELAY_MS', '150'));
  return isFinite(n) && n >= 0 ? n : 150;
}

/**
 * Check if current user is admin
 * @returns {boolean} True if user is admin
 */
function isAdmin_() {
  const raw = (PropertiesService.getScriptProperties()
              .getProperty('SMS_ADMIN_EMAILS') || '').trim().toLowerCase();
  if (!raw) return false;      // No property = default deny
  if (raw === '*') return true; // Wildcard: allow anyone (passcode will still gate actions)
  
  const allow = raw.split(/[\s,;]+/).filter(Boolean);
  const me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!me) return false;
  return allow.includes(me);
}

/**
 * Require admin access or throw error
 * @throws {Error} If user is not admin
 */
function requireAdmin_() {
  if (!isAdmin_()) throw new Error('Not authorized (admin check failed).');
}

/**
 * Debug admin configuration
 */
function debugIsAdmin() {
  const raw = PropertiesService.getScriptProperties().getProperty('SMS_ADMIN_EMAILS');
  Logger.log('SMS_ADMIN_EMAILS = "%s"', raw);
  Logger.log('Session email = "%s"', Session.getActiveUser().getEmail());
  Logger.log('isAdmin_() = %s', isAdmin_());
}

// =============================================================================
// 2) PASSWORD AUTHENTICATION CORE
// =============================================================================

/**
 * Get stored password hash
 * @returns {string} Password hash
 */
function passHash_() {
  const h = (PropertiesService.getScriptProperties()
            .getProperty('SMS_PANEL_PASS_SHA256') || '').trim();
  return h.toLowerCase();
}

/**
 * Generate SHA-256 hash of string
 * @param {string} s - String to hash
 * @returns {string} Hexadecimal hash
 */
function sha256Hex_(s) {
  const clean = String(s || '').normalize('NFC').trim();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clean);
  return bytes.map(b => (b + 256) % 256).map(n => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if UI needs password prompt
 * @returns {boolean} True if password is required
 */
function uiNeedsPass() {
  const required = passHash_();
  if (!required) return false; // No pass configured
  
  const up = PropertiesService.getUserProperties();
  const stored = (up.getProperty('SMS_AUTH_HASH') || '').trim().toLowerCase();
  const ts = Number(up.getProperty('SMS_AUTH_TIME') || '0');
  const freshForMs = 12 * 60 * 60 * 1000; // 12h session
  
  return !(stored === required && (Date.now() - ts) < freshForMs);
}

/**
 * Validate password and create session
 * @param {string} candidate - Password to check
 * @returns {Object} Result object with ok and msg properties
 */
function uiCheckPass(candidate) {
  const required = passHash_();
  if (!required) return { ok: false, msg: 'No pass configured.' };
  
  const ok = (sha256Hex_(candidate) === required);
  if (ok) {
    const up = PropertiesService.getUserProperties();
    up.setProperty('SMS_AUTH_HASH', required);
    up.setProperty('SMS_AUTH_TIME', String(Date.now()));
  }
  
  return { ok, msg: ok ? 'OK' : 'Invalid passcode.' };
}

/**
 * Require valid password or throw error
 * @throws {Error} If password is invalid or expired
 */
function requirePass_() {
  const required = passHash_();
  if (!required) return; // No pass set
  
  const up = PropertiesService.getUserProperties();
  const stored = (up.getProperty('SMS_AUTH_HASH') || '').trim().toLowerCase();
  const ts = Number(up.getProperty('SMS_AUTH_TIME') || '0');
  const fresh = (Date.now() - ts) < 12 * 60 * 60 * 1000; // 12h TTL
  
  if (stored !== required || !fresh) throw new Error('Passcode required.');
}

// =============================================================================
// 3) DEBUG HELPERS (AUTH)
// =============================================================================

/**
 * Debug event retrieval
 */
function debugUiGetEvents() {
  requireAdmin_(); 
  requirePass_();
  const res = uiGetEvents();
  Logger.log('events: ' + JSON.stringify(res));
}

/**
 * Debug template retrieval
 */
function debugUiGetTemplates() {
  requireAdmin_(); 
  requirePass_();
  const res = uiGetTemplates();
  Logger.log('templates: ' + JSON.stringify(res));
}

// =============================================================================
// 4) UTILITIES
// =============================================================================

/**
 * Format event date for display
 * @param {Date|string} val - Date value to format
 * @returns {string} Formatted date string
 */
function formatEventDate_(val) {
  if (!val) return '';
  
  const tz = Session.getScriptTimeZone() || 'America/New_York';
  let d = val;
  
  // Sheet cells often come in as Date objects; otherwise try parsing
  if (!(d instanceof Date)) {
    const parsed = new Date(val);
    if (isNaN(parsed.getTime())) return String(val); // Fallback raw
    d = parsed;
  }
  
  // Format: "Fri, Jul 18 @ 6:00 PM"
  const day = Utilities.formatDate(d, tz, 'E');
  const md = Utilities.formatDate(d, tz, 'MMM d');
  const time = Utilities.formatDate(d, tz, 'h:mm a');
  return `${day}, ${md} @ ${time}`;
}

// =============================================================================
// 5) MESSAGE TEMPLATES
// =============================================================================

/**
 * Standard SMS footer
 * @returns {string} Footer text
 */
function smsFooter_() { 
  return ' Reply STOP to opt out. HELP for help.'; 
}

/**
 * Welcome message template
 * @param {string} name - Student name
 * @returns {string} Welcome message
 */
function welcomeTemplate_(name) {
  const n = name ? `, ${name}` : '';
  return `Thanks for opting in${n}! You'll receive club updates and reminders.` + smsFooter_();
}

/**
 * Thank you message template
 * @param {string} title - Event title
 * @param {string} dateStr - Event date
 * @returns {string} Thank you message
 */
function thankYouTemplate_(title, dateStr) {
  const t = title || 'the event'; 
  const d = dateStr ? ` on ${dateStr}` : '';
  return `Thanks for attending ${t}${d}!{footer}`;
}

/**
 * Reminder message template
 * @param {string} title - Event title
 * @param {string} dateStr - Event date
 * @param {string} location - Event location
 * @returns {string} Reminder message
 */
function reminderTemplate_(title, dateStr, location) {
  const t = title || 'the event';
  const when = dateStr ? ` on ${dateStr}` : '';
  const where = location ? ` at ${location}` : '';
  return `Reminder: ${t}${when}${where}. We look forward to seeing you.` + smsFooter_();
}

// =============================================================================
// 6) UI MENUS
// =============================================================================

/**
 * Master onOpen function - creates all menus
 * IMPORTANT: Use only ONE master onOpen() in the project
 */
function onOpen() {
  try { 
    if (typeof onOpenStudentSync_ === 'function') onOpenStudentSync_(); 
  } catch(e) {}
  try { 
    onOpenSms_(); 
  } catch(e) {}
}

/**
 * Create SMS management menu
 */
function onOpenSms_() {
  if (!isAdmin_()) return; // Do not render menu if not admin

  SpreadsheetApp.getUi()
    .createMenu('SMS')
    .addItem('Open composer (sidebar)', 'openSmsComposer')
    .addItem('Open composer (window)', 'openSmsComposerDialog')
    .addSeparator()
    .addItem('Send test to myself', 'menuSendTestToSelf')
    .addSeparator()
    .addItem('Resend failures', 'resendFailures_')
    .addToUi();
}

/**
 * Open SMS composer in sidebar
 */
function openSmsComposer() {
  requireAdmin_();
  const html = HtmlService.createHtmlOutputFromFile('smsSidebar').setTitle('SMS Composer');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Open SMS composer in modal dialog
 */
function openSmsComposerDialog() {
  requireAdmin_(); 
  const html = HtmlService.createHtmlOutputFromFile('smsSidebar').setWidth(900).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'SMS Composer');
}

/**
 * Send test SMS to admin
 */
function menuSendTestToSelf() {
  requireAdmin_(); 
  requirePass_();
  
  const me = getProp_('ADMIN_TEST_NUMBER', '');
  if (!me) {
    return SpreadsheetApp.getUi().alert('Set ADMIN_TEST_NUMBER in Script Properties.');
  }
  
  const body = 'Test from progsu SMS' + smsFooter_();
  return sendOneWithControls_(me, body);
}

// =============================================================================
// 7) CORE SMS SENDING
// =============================================================================

/**
 * Send SMS with rate limiting and dry-run support
 * @param {string} toPhoneE164 - Recipient phone in E.164 format
 * @param {string} body - Message body
 */
function sendOneWithControls_(toPhoneE164, body) {
  requireAdmin_(); 
  requirePass_();   // Hard stop
  
  const delay = rateDelayMs_();
  
  if (isDryRun_()) {
    safeLogSms_(toPhoneE164, '[DRY RUN] ' + body, 'DRYRUN', 0, '');
  } else {
    sendSms_(toPhoneE164, body);
  }
  
  if (delay > 0) Utilities.sleep(delay);
}

/**
 * Safely log SMS activity
 * @param {string} to - Recipient
 * @param {string} body - Message body
 * @param {string} sid - Message SID
 * @param {number} httpCode - HTTP response code
 * @param {string} errorMsg - Error message
 */
function safeLogSms_(to, body, sid, httpCode, errorMsg) {
  try {
    logSms_(to, body, sid, httpCode, errorMsg);
  } catch (e) {
    Logger.log('LOG FAIL: ' + e);
  }
}

/**
 * Send bulk SMS to all opted-in students
 * @param {string} message - Message to send
 */
function sendBulkToOptedIn_(message) {
  requireAdmin_();
  requirePass_();
  
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName('Student Database');
  if (!db) throw new Error('Missing "Student Database" sheet.');
  
  const vals = db.getDataRange().getValues();
  const hdr = Object.fromEntries(vals[0].map((h, i) => [String(h), i]));
  
  for (let r = 1; r < vals.length; r++) {
    const opt = String(vals[r][hdr['SMS Opt-In']] || '').toLowerCase();
    const phone = vals[r][hdr['Phone #']];
    if (opt === 'yes' && phone) {
      sendOneWithControls_(toE164_(phone), message + smsFooter_());
    }
  }
}

/**
 * Send thank you SMS for event attendance
 * @param {string} eventId - Event identifier
 */
function sendThankYouForEvent_(eventId) {
  requireAdmin_();
  requirePass_();
  
  const { title, date } = getEventInfo_(eventId);
  const body = thankYouTemplate_(title, date);
  sendToEventAttendees_(eventId, body);
}

/**
 * Send reminder SMS for upcoming event
 * @param {string} eventId - Event identifier
 */
function sendReminderForEvent_(eventId) {
  requireAdmin_();
  requirePass_();
  
  const { title, date, location } = getEventInfo_(eventId);
  const body = reminderTemplate_(title, date, location);
  sendToEventAttendees_(eventId, body);
}

/**
 * Send SMS to event attendees
 * @param {string} eventId - Event identifier
 * @param {string} body - Message body
 */
function sendToEventAttendees_(eventId, body) {
  const ss = SpreadsheetApp.getActive();
  const att = ss.getSheetByName('Attendance');
  const db = ss.getSheetByName('Student Database');
  
  if (!att || !db) {
    throw new Error('Missing "Attendance" or "Student Database" sheet');
  }

  const aVals = att.getDataRange().getValues();
  const aHdrs = aVals[0].map(String);
  const aColEvent = aHdrs.indexOf('Event ID');
  const aColCampus = aHdrs.indexOf('Campus Email');
  
  if (aColEvent < 0 || aColCampus < 0) {
    throw new Error('Attendance needs headers "Event ID" and "Campus Email".');
  }

  const dVals = db.getDataRange().getValues();
  const dHdrs = dVals[0].map(String);
  const dColCampus = dHdrs.indexOf('Campus Email');
  const dColPhone = dHdrs.indexOf('Phone #');
  const dColOpt = dHdrs.indexOf('SMS Opt-In');

  const byCampus = new Map();
  for (let i = 1; i < dVals.length; i++) {
    const ce = String(dVals[i][dColCampus] || '').trim().toLowerCase();
    if (ce) byCampus.set(ce, dVals[i]);
  }

  const seen = new Set();
  for (let r = 1; r < aVals.length; r++) {
    if (String(aVals[r][aColEvent]).trim() !== eventId) continue;
    
    const ce = String(aVals[r][aColCampus] || '').trim().toLowerCase();
    if (!ce || seen.has(ce)) continue;
    seen.add(ce);

    const row = byCampus.get(ce);
    if (!row) continue;
    
    const opt = String(row[dColOpt] || '').toLowerCase();
    const phone = row[dColPhone];
    if (opt === 'yes' && phone) {
      sendOneWithControls_(toE164_(phone), body);
    }
  }
}

// =============================================================================
// 9) SIDEBAR RPC (UI BRIDGE)
// =============================================================================

/**
 * Get available message templates
 * @returns {Array} Array of template objects
 */
function uiGetTemplates() {
  requireAdmin_(); 
  requirePass_();
  
  return [
    {
      key: 'thankyou',
      label: 'Thank you',
      body: 'Thank you for attending {title}!\nSee upcoming events at https://www.progsu.com/events\n\n{footer}'
    },
    {
      key: 'reminder',
      label: 'Reminder',
      body: '{firstName}{firstName? , }Reminder about {title}{date? on {date}}{location? at {location}}.\nWe hope to see you there.\n\n{footer}'
    },
    {
      key: 'blank',
      label: 'Blank',
      body: '\n\n{footer}'
    }
  ];
}

/**
 * Get available events from Event Log
 * @returns {Array} Array of event objects
 */
function uiGetEvents() {
  requireAdmin_(); 
  requirePass_();
  
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Event Log');
  if (!sh) return [];

  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  if (lastRow < 4) return []; // No data

  const headers = sh.getRange(3, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

  const colId = headers.indexOf('Event ID');                       // A
  const colDate = headers.findIndex(h => h === 'Date (MM/DD/20YY HH:MM AM/PM)'); // B
  const colLoc = headers.indexOf('Location');                       // C
  const colT = headers.indexOf('Public Event Title');             // I

  if (colId < 0) return [];

  const rows = sh.getRange(4, 1, lastRow - 3, lastCol).getValues();
  const out = [];
  
  for (const r of rows) {
    const id = String(r[colId] || '').trim();
    if (!id) continue;
    
    out.push({
      id,
      title: colT >= 0 ? String(r[colT] || '') : '',
      date: colDate >= 0 ? String(r[colDate] || '') : '',
      location: colLoc >= 0 ? String(r[colLoc] || '') : ''
    });
  }
  
  return out;
}

/**
 * Get audience information for event
 * @param {string} eventId - Event identifier
 * @param {string} audienceKey - Audience type
 * @returns {Object} Audience information
 */
function uiGetAudienceInfo(eventId, audienceKey) {
  requireAdmin_(); 
  requirePass_();
  
  const { people } = resolveAudience_(eventId, audienceKey);
  return { count: people.length };
}

/**
 * Preview message with template variables resolved
 * @param {string} body - Message template
 * @param {string} eventId - Event identifier
 * @returns {string} Rendered message
 */
function uiRenderPreview(body, eventId) {
  requireAdmin_(); 
  requirePass_();
  
  const ev = getEventInfo_(eventId) || { title: '', date: '', location: '' };
  const footer = smsFooter_();
  const ctx = {
    title: (ev.title || '').trim(),
    date: (ev.date || '').trim(),
    location: (ev.location || '').trim(),
    footer
  };

  // Normalize line breaks early; keep \n for SMS & preview
  let out = String(body || '').replace(/\r\n/g, '\n').trim();

  // 1) Protect simple placeholders so optional-block regex stays simple
  out = out
    .replace(/\{title\}/g, '<<TITLE>>')
    .replace(/\{date\}/g, '<<DATE>>')
    .replace(/\{location\}/g, '<<LOCATION>>')
    .replace(/\{footer\}/g, '<<FOOTER>>');

  // 2) Expand optional segments like {date? on <<DATE>>}
  out = out.replace(/\{(\w+)\?\s*([^}]*)\}/g, (_, key, seg) => {
    const val = (ctx[key] || '').trim();
    return val ? seg : '';
  });

  // 3) Restore tokens to actual values
  out = out
    .replace(/<<TITLE>>/g, ctx.title)
    .replace(/<<DATE>>/g, ctx.date)
    .replace(/<<LOCATION>>/g, ctx.location)
    .replace(/<<FOOTER>>/g, ctx.footer);

  // 4) Final cleanup
  out = out
    .replace(/[^\S\n]+/g, ' ')             // Collapse spaces/tabs but keep \n
    .replace(/[ \t]+([!?.,;:])/g, '$1')    // No space before punctuation
    .split('\n')
    .map(line => line.replace(/^[ \t]+|[ \t]+$/g, '')) // Trim each line
    .join('\n')
    .trim();

  return out;
}

/**
 * Send SMS to audience
 * @param {Object} payload - Send parameters
 * @param {string} payload.eventId - Event identifier
 * @param {string} payload.audienceKey - Audience type
 * @param {string} payload.body - Message body
 * @returns {Object} Result with count of messages sent
 */
function uiSend(payload) {
  requireAdmin_();
  requirePass_();
  
  const { eventId, audienceKey, body } = payload;
  const base = uiRenderPreview(body, eventId);
  const { people } = resolveAudience_(eventId, audienceKey);

  for (const p of people) {
    let msg = base.replace(/\{firstName\}/g, p.firstName || '');
    sendOneWithControls_(toE164_(p.phone), msg);
  }
  
  return { sent: people.length };
}

/**
 * Resolve audience based on event and type
 * @param {string} eventId - Event identifier
 * @param {string} audienceKey - Audience type
 * @returns {Object} Object with people array
 */
function resolveAudience_(eventId, audienceKey) {
  const ss = SpreadsheetApp.getActive();
  const att = ss.getSheetByName('Attendance');
  const db = ss.getSheetByName('Student Database');
  if (!db) return { people: [] };

  const dVals = db.getDataRange().getValues();
  const dh = dVals[0].map(String);
  const dCampus = dh.indexOf('Campus Email');
  const dPhone = dh.indexOf('Phone #');
  const dOpt = dh.indexOf('SMS Opt-In');
  const dName = dh.indexOf('Student Name');

  const byCampus = new Map();
  for (let i = 1; i < dVals.length; i++) {
    const ce = String(dVals[i][dCampus] || '').trim().toLowerCase();
    if (ce) byCampus.set(ce, dVals[i]);
  }

  let emails = new Set();
  if (audienceKey === 'attendees') {
    if (!att) return { people: [] };
    
    const aVals = att.getDataRange().getValues();
    const ah = aVals[0].map(String);
    const aId = ah.indexOf('Event ID');
    const aCE = ah.indexOf('Campus Email');
    
    for (let i = 1; i < aVals.length; i++) {
      if (String(aVals[i][aId]).trim() !== String(eventId).trim()) continue;
      const ce = String(aVals[i][aCE] || '').trim().toLowerCase();
      if (ce) emails.add(ce);
    }
  } else if (audienceKey === 'alloptedin') {
    for (let i = 1; i < dVals.length; i++) {
      const opt = String(dVals[i][dOpt] || '').toLowerCase();
      const ce = String(dVals[i][dCampus] || '').trim().toLowerCase();
      if (opt === 'yes' && ce) emails.add(ce);
    }
  }

  const people = [];
  for (const ce of emails) {
    const row = byCampus.get(ce);
    if (!row) continue;
    
    const opt = String(row[dOpt] || '').toLowerCase();
    const phone = row[dPhone];
    if (opt === 'yes' && phone) {
      const name = String(row[dName] || '').trim();
      const firstName = name ? name.split(/\s+/)[0] : '';
      people.push({ campusEmail: ce, phone: String(phone), firstName });
    }
  }
  
  return { people };
}

// =============================================================================
// 8) AUDIENCE RESOLUTION AND EVENT INFO
// =============================================================================

/**
 * Get event information from Event Log
 * @param {string} eventId - Event identifier
 * @returns {Object} Event information object
 */
function getEventInfo_(eventId) {
  const ss = SpreadsheetApp.getActive();
  const log = ss.getSheetByName('Event Log');
  if (!log) return { title: 'our event', date: '', location: '' };

  const lastCol = log.getLastColumn();
  const lastRow = log.getLastRow();
  if (lastRow < 4) return { title: 'our event', date: '', location: '' };

  const headers = log.getRange(3, 1, 1, lastCol).getValues()[0].map(String);
  const data = log.getRange(4, 1, lastRow - 3, lastCol).getValues();

  const colId = headers.indexOf('Event ID');                       // A
  const colDate = headers.indexOf('Date (MM/DD/20YY HH:MM AM/PM)');  // B
  const colLoc = headers.indexOf('Location');                       // C
  const colT = headers.indexOf('Public Event Title');             // I

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][colId] || '').trim() === String(eventId).trim()) {
      const rawDate = colDate >= 0 ? data[i][colDate] : '';
      return {
        title: colT >= 0 ? data[i][colT] : 'our event',
        date: formatEventDate_(rawDate),
        location: colLoc >= 0 ? data[i][colLoc] : ''
      };
    }
  }
  
  return { title: 'our event', date: '', location: '' };
}

// =============================================================================
// 10) FAILURE RETRY AND MISC
// =============================================================================

/**
 * Retry failed SMS sends from SMS Log
 */
function resendFailures_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SMS Log');
  if (!sh) return SpreadsheetApp.getUi().alert('No "SMS Log" sheet found.');

  const vals = sh.getDataRange().getValues();
  if (vals.length <= 1) return SpreadsheetApp.getUi().alert('No log entries to retry.');
  
  const hdrs = vals[0].map(String);
  const cTo = hdrs.indexOf('To');
  const cBody = hdrs.indexOf('Body');
  const cCode = hdrs.indexOf('HTTP Code');
  const cStat = hdrs.indexOf('Status');
  
  if (cTo < 0 || cBody < 0) {
    return SpreadsheetApp.getUi().alert('SMS Log missing To/Body headers.');
  }

  let retried = 0;
  for (let r = 1; r < vals.length; r++) {
    const to = vals[r][cTo];
    const body = vals[r][cBody];
    const code = cCode >= 0 ? Number(vals[r][cCode]) : 0;
    const stat = cStat >= 0 ? String(vals[r][cStat] || '') : '';
    const failed = (code >= 400) || (stat && stat.toLowerCase() === 'failed');
    
    if (!failed || !to || !body) continue;
    
    sendOneWithControls_(String(to), String(body));
    retried++;
  }
  
  SpreadsheetApp.getUi().alert(`Retried ${retried} failed sends.`);
}

/**
 * Simple ping function for testing
 * @returns {string} Always returns 'pong'
 */
function uiPing() { 
  return 'pong'; 
}
