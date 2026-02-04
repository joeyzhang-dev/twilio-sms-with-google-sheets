function runSetSmsPass() {
  smsAuthResetMe_();
  setSmsPassFromPlaintext_('fearlessjenny1');
  smsAuthHashTest_('fearlessjenny1');
  smsAuthDebug_();
}


// Helper you run once (no underscore so you can run it from the editor)
function setSmsPassFromPlaintext(plain) {
  const hex = sha256Hex_(String(plain));
  PropertiesService.getScriptProperties().setProperty('SMS_PANEL_PASS_SHA256', hex);
  Logger.log('Set SMS_PANEL_PASS_SHA256: ' + hex);
}


function smsAuthDebug_() {
  const sp = PropertiesService.getScriptProperties();
  const up = PropertiesService.getUserProperties();
  const H = (sp.getProperty('SMS_PANEL_PASS_SHA256') || '').trim();
  Logger.log('Script hash length: %s', H.length);     // must be 64
  Logger.log('Script hash (first 8): %s', H.slice(0,8)); // sanity peek
  Logger.log('User stored hash (first 8): %s', (up.getProperty('SMS_AUTH_HASH')||'').slice(0,8));
  Logger.log('Needs pass? %s', uiNeedsPass());
}


// (Optional) reset your own session while testing
function smsAuthResetMe() {
  PropertiesService.getUserProperties().deleteAllProperties();
}

// Test a PLAINTEXT to see what its hash would be
function smsAuthHashTest_(plain) {
  Logger.log('Test hash: %s', sha256Hex_(String(plain)));
}


/***** Script properties helpers *****/
function getProp_(k, dft) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  return v !== null && v !== undefined && v !== '' ? v : dft;
}
function isDryRun_() {
  return String(getProp_('SMS_DRY_RUN','false')).toLowerCase() === 'true';
}
function rateDelayMs_() {
  const n = Number(getProp_('SMS_RATE_DELAY_MS','150'));
  return isFinite(n) && n >= 0 ? n : 150;
}

function isAdmin_() {
  const raw = (PropertiesService.getScriptProperties()
              .getProperty('SMS_ADMIN_EMAILS') || '').trim().toLowerCase();
  if (!raw) return false;      // no property = default deny
  if (raw === '*') return true; // wildcard: allow anyone (passcode will still gate actions)
  const allow = raw.split(/[\s,;]+/).filter(Boolean);
  const me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!me) return false;
  return allow.includes(me);
}
function requireAdmin_() {
  if (!isAdmin_()) throw new Error('Not authorized (admin check failed).');
}

// === PASSCODE CORE (single source of truth) ===
function passHash_() {
  const h = (PropertiesService.getScriptProperties()
            .getProperty('SMS_PANEL_PASS_SHA256') || '').trim();
  return h.toLowerCase();
}
function sha256Hex_(s) {
  const clean = String(s || '').normalize('NFC').trim();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clean);
  return bytes.map(b => (b + 256) % 256).map(n => n.toString(16).padStart(2, '0')).join('');
}
// Called by sidebar to decide whether to show the prompt
function uiNeedsPass() {
  const required = passHash_();
  if (!required) return false; // no pass configured
  const up = PropertiesService.getUserProperties();
  const stored = (up.getProperty('SMS_AUTH_HASH') || '').trim().toLowerCase();
  const ts = Number(up.getProperty('SMS_AUTH_TIME') || '0');
  const freshForMs = 12 * 60 * 60 * 1000; // 12h session
  return !(stored === required && (Date.now() - ts) < freshForMs);
}
// Called by sidebar when user clicks Unlock
function uiCheckPass(candidate) {
  const required = passHash_();
  if (!required) return { ok:false, msg:'No pass configured.' };
  const ok = (sha256Hex_(candidate) === required);
  if (ok) {
    const up = PropertiesService.getUserProperties();
    up.setProperty('SMS_AUTH_HASH', required);
    up.setProperty('SMS_AUTH_TIME', String(Date.now()));
  }
  return { ok, msg: ok ? 'OK' : 'Invalid passcode.' };
}
function requirePass_() {
  const required = passHash_();
  if (!required) return; // no pass set
  const up = PropertiesService.getUserProperties();
  const stored = (up.getProperty('SMS_AUTH_HASH') || '').trim().toLowerCase();
  const ts = Number(up.getProperty('SMS_AUTH_TIME') || '0');
  const fresh = (Date.now() - ts) < 12*60*60*1000; // 12h TTL
  if (stored !== required || !fresh) throw new Error('Passcode required.');
}

function debugIsAdmin() {
  const raw = PropertiesService.getScriptProperties().getProperty('SMS_ADMIN_EMAILS');
  Logger.log('SMS_ADMIN_EMAILS = "%s"', raw);
  Logger.log('Session email = "%s"', Session.getActiveUser().getEmail());
  Logger.log('isAdmin_() = %s', isAdmin_());
}



function debugUiGetEvents() {
  requireAdmin_(); 
  requirePass_();
  const res = uiGetEvents();
  Logger.log('events: ' + JSON.stringify(res));
}

function debugUiGetTemplates() {
  requireAdmin_(); 
  requirePass_();
  const res = uiGetTemplates();
  Logger.log('templates: ' + JSON.stringify(res));
}

function formatEventDate_(val) {
  if (!val) return '';
  const tz = Session.getScriptTimeZone() || 'America/New_York';
  let d = val;
  // Sheet cells often come in as Date objects; otherwise try parsing.
  if (!(d instanceof Date)) {
    const parsed = new Date(val);
    if (isNaN(parsed.getTime())) return String(val); // fallback raw
    d = parsed;
  }
  // e.g., "Fri, Jul 18 @ 6:00 PM"
  const day  = Utilities.formatDate(d, tz, 'E');
  const md   = Utilities.formatDate(d, tz, 'MMM d');
  const time = Utilities.formatDate(d, tz, 'h:mm a');
  return `${day}, ${md} @ ${time}`;
}


/***** Message templates (edit copy here) *****/
function smsFooter_() { return ' Reply STOP to opt out. HELP for help.'; }
function welcomeTemplate_(name) {
  const n = name ? `, ${name}` : '';
  return `Thanks for opting in ${n}! You’ll receive CS Club updates and reminders.` + smsFooter_();
}
function thankYouTemplate_(title, dateStr) {
  const t = title || 'the event'; const d = dateStr ? ` on ${dateStr}` : '';
  return `Thanks for attending ${t}${d}!{footer}`;
}
function reminderTemplate_(title, dateStr, location) {
  const t = title || 'the event';
  const when = dateStr ? ` on ${dateStr}` : '';
  const where = location ? ` at ${location}` : '';
  return `Reminder: ${t}${when}${where}. See you there!` + smsFooter_();
}

/***** Menus *****/



// Checks a pass; on success remember the script hash for this user

// Enforce gate on RPCs






// IMPORTANT: Use ONE master onOpen() in the project.
// If you already have a Student Sync menu, rename it to onOpenStudentSync_()
// This master calls both menus safely.
function onOpen() {
  try { if (typeof onOpenStudentSync_ === 'function') onOpenStudentSync_(); } catch(e) {}
  try { onOpenSms_(); } catch(e) {}
  // Bulk SMS menu - uncomment after verifying smsBulkSend.js is working
  // try { if (typeof onOpenBulkSms_ === 'function') onOpenBulkSms_(); } catch(e) { Logger.log('Bulk SMS menu error: ' + e); }
}

function onOpenSms_() {
  // Temporarily disabled admin check for debugging
  // if (!isAdmin_()) return; // <— do not render menu if not admin

  SpreadsheetApp.getUi()
    .createMenu('SMS')
    .addItem('Open composer (sidebar)', 'openSmsComposer')
    .addItem('Open composer (window)',  'openSmsComposerDialog')
    .addSeparator()
    .addItem('Send test to myself',      'menuSendTestToSelf')
    .addSeparator()
    .addItem('Resend failures',          'resendFailures_')
    .addToUi();
}


function openSmsComposer() {
  requireAdmin_();
  const html = HtmlService.createHtmlOutputFromFile('smsSidebar').setTitle('SMS Composer');
  SpreadsheetApp.getUi().showSidebar(html);
}
function openSmsComposerDialog() {
  requireAdmin_(); 
  const html = HtmlService.createHtmlOutputFromFile('smsSidebar').setWidth(900).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'SMS Composer');
}

function menuSendTestToSelf() {
  requireAdmin_(); requirePass_();
  const me = getProp_('ADMIN_TEST_NUMBER','');
  if (!me) return SpreadsheetApp.getUi().alert('Set ADMIN_TEST_NUMBER in Script Properties.');
  const body = 'Test from progsu SMS ✅' + smsFooter_();
  return sendOneWithControls_(me, body);
}

/***** Core senders (rate limit + dry-run) *****/
function sendOneWithControls_(toPhoneE164, body) {
  requireAdmin_(); requirePass_();   // <— hard stop
  const delay = rateDelayMs_();
  if (isDryRun_()) {
    safeLogSms_(toPhoneE164, '[DRY RUN] ' + body, 'DRYRUN', 0, '');
  } else {
    const result = sendSms_(toPhoneE164, body);
    // Don't throw on error - just log it and continue
    if (!result.success) {
      Logger.log(`Send failed to ${toPhoneE164}: ${result.error} (code: ${result.errorCode || 'unknown'})`);
    }
  }
  if (delay > 0) Utilities.sleep(delay);
}
function safeLogSms_(to, body, sid, httpCode, errorMsg) {
  try {
    logSms_(to, body, sid, httpCode, errorMsg);
  } catch (e) {
    Logger.log('LOG FAIL: ' + e);
  }
}


function sendBulkToOptedIn_(message) {
  requireAdmin_();
  requirePass_();
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName('Student Database');
  if (!db) throw new Error('Missing "Student Database" sheet.');
  const vals = db.getDataRange().getValues();
  const hdr = Object.fromEntries(vals[0].map((h,i)=>[String(h), i]));
  for (let r=1; r<vals.length; r++) {
    const opt = String(vals[r][hdr['SMS Opt-In']]||'').toLowerCase();
    const phone = vals[r][hdr['Phone #']];
    if (opt === 'yes' && phone) {
      sendOneWithControls_(toE164_(phone), message + smsFooter_());
    }
  }
}

function sendThankYouForEvent_(eventId) {
  requireAdmin_();
  requirePass_();
  const {title, date} = getEventInfo_(eventId);
  const body = thankYouTemplate_(title, date);
  sendToEventAttendees_(eventId, body);
}
function sendReminderForEvent_(eventId) {
  requireAdmin_();
  requirePass_();
  const {title, date, location} = getEventInfo_(eventId);
  const body = reminderTemplate_(title, date, location);
  sendToEventAttendees_(eventId, body);
}

// Attendance -> Campus Email -> DB phone + opt-in
function sendToEventAttendees_(eventId, body) {
  const ss = SpreadsheetApp.getActive();
  const att = ss.getSheetByName('Attendance');
  const db  = ss.getSheetByName('Student Database');
  if (!att || !db) throw new Error('Missing "Attendance" or "Student Database" sheet');

  const aVals = att.getDataRange().getValues();
  const aHdrs = aVals[0].map(String);
  const aColEvent  = aHdrs.indexOf('Event ID');
  const aColCampus = aHdrs.indexOf('Campus Email');
  if (aColEvent < 0 || aColCampus < 0) throw new Error('Attendance needs headers "Event ID" and "Campus Email".');

  const dVals = db.getDataRange().getValues();
  const dHdrs = dVals[0].map(String);
  const dColCampus = dHdrs.indexOf('Campus Email');
  const dColPhone  = dHdrs.indexOf('Phone #');
  const dColOpt    = dHdrs.indexOf('SMS Opt-In');

  const byCampus = new Map();
  for (let i=1;i<dVals.length;i++){
    const ce = String(dVals[i][dColCampus]||'').trim().toLowerCase();
    if (ce) byCampus.set(ce, dVals[i]);
  }

  const seen = new Set();
  for (let r=1;r<aVals.length;r++){
    if (String(aVals[r][aColEvent]).trim() !== eventId) continue;
    const ce = String(aVals[r][aColCampus]||'').trim().toLowerCase();
    if (!ce || seen.has(ce)) continue;
    seen.add(ce);

    const row = byCampus.get(ce);
    if (!row) continue;
    const opt = String(row[dColOpt]||'').toLowerCase();
    const phone = row[dColPhone];
    if (opt === 'yes' && phone) {
      sendOneWithControls_(toE164_(phone), body);
    }
  }
}

/***** Sidebar RPCs *****/
function uiGetTemplates() {
  requireAdmin_(); 
  requirePass_();
  return [
    {
      key:'thankyou', 
    label:'Thank-you', 
    body:'Appreciate you pulling up to {title}! \nPeep more events 👉 https://www.progsu.com/events\n\n{footer}'
    },
    {
      key:'reminder', 
    label:'Reminder', 
    body:'Ayo {firstName} don\'t forget to pullup to {title} {date? on {date}} {location? at {location}}.\nSee you there!\n\n{footer}'
    },
    {
      key:'blank',    
    label:'Blank',    
    body:'\n\n{footer}'
    }
  ];
}

// Your Event Log: headers on row 3 (A3:L3) with:
// A: Event ID, B: Date (MM/DD/20YY HH:MM AM/PM), C: Location, I: Public Event Title
function uiGetEvents() {
  requireAdmin_(); 
  requirePass_();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Event Log');
  if (!sh) return [];

  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  if (lastRow < 4) return []; // no data

  const headers = sh.getRange(3, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

  const colId   = headers.indexOf('Event ID');                       // A
  const colDate = headers.findIndex(h => h === 'Date (MM/DD/20YY HH:MM AM/PM)'); // B
  const colLoc  = headers.indexOf('Location');                       // C
  const colT    = headers.indexOf('Public Event Title');             // I

  if (colId < 0) return [];

  const rows = sh.getRange(4, 1, lastRow - 3, lastCol).getValues();
  const out = [];
  for (const r of rows) {
    const id = String(r[colId] || '').trim();
    if (!id) continue;
    out.push({
      id,
      title:    colT    >= 0 ? String(r[colT]    || '') : '',
      date:     colDate >= 0 ? String(r[colDate] || '') : '',
      location: colLoc  >= 0 ? String(r[colLoc]  || '') : ''
    });
  }
  return out;
}

function uiGetAudienceInfo(eventId, audienceKey) {
  requireAdmin_(); 
  requirePass_();
  const {people} = resolveAudience_(eventId, audienceKey);
  return {count: people.length};
}

// Preview renderer with optional sections like {date? on {date}}
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

  // Normalize line breaks early; keep \n for SMS & preview (pre-wrap handles it)
  let out = String(body || '').replace(/\r\n/g, '\n').trim();

  // 1) Protect simple placeholders so optional-block regex stays simple
  out = out
    .replace(/\{title\}/g, '<<TITLE>>')
    .replace(/\{date\}/g, '<<DATE>>')
    .replace(/\{location\}/g, '<<LOCATION>>')
    .replace(/\{footer\}/g, '<<FOOTER>>');

  // 2) Expand optional segments like {date? on <<DATE>>}
  //    Safe now because seg cannot include '}' anymore
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

  // 4) Final tidy:
  //    - collapse spaces/tabs (NOT newlines)
  //    - remove extra space before punctuation (within lines)
  //    - trim spaces at the start/end of each line
  out = out
    .replace(/[^\S\n]+/g, ' ')             // collapse spaces/tabs but keep \n
    .replace(/[ \t]+([!?.,;:])/g, '$1')    // no space before punctuation
    .split('\n')
    .map(line => line.replace(/^[ \t]+|[ \t]+$/g, '')) // trim each line
    .join('\n')
    .trim();

  return out; // keep \n; preview uses textContent + CSS pre-wrap
}




function uiSend(payload) {
  requireAdmin_();
  requirePass_();
  const { eventId, audienceKey, body } = payload;
  const base = uiRenderPreview(body, eventId);
  const {people} = resolveAudience_(eventId, audienceKey);

  for (const p of people) {
    let msg = base.replace(/\{firstName\}/g, p.firstName || '');
    sendOneWithControls_(toE164_(p.phone), msg);
  }
  return {sent: people.length};
}

// Build audience: attendees for event OR all opted-in
function resolveAudience_(eventId, audienceKey) {
  const ss = SpreadsheetApp.getActive();
  const att = ss.getSheetByName('Attendance');
  const db  = ss.getSheetByName('Student Database');
  if (!db) return {people:[]};

  const dVals = db.getDataRange().getValues();
  const dh = dVals[0].map(String);
  const dCampus = dh.indexOf('Campus Email');
  const dPhone  = dh.indexOf('Phone #');
  const dOpt    = dh.indexOf('SMS Opt-In');
  const dName   = dh.indexOf('Student Name');

  const byCampus = new Map();
  for (let i=1;i<dVals.length;i++){
    const ce = String(dVals[i][dCampus]||'').trim().toLowerCase();
    if (ce) byCampus.set(ce, dVals[i]);
  }

  let emails = new Set();
  if (audienceKey === 'attendees') {
    if (!att) return {people:[]};
    const aVals = att.getDataRange().getValues();
    const ah = aVals[0].map(String);
    const aId  = ah.indexOf('Event ID');
    const aCE  = ah.indexOf('Campus Email');
    for (let i=1;i<aVals.length;i++){
      if (String(aVals[i][aId]).trim() !== String(eventId).trim()) continue;
      const ce = String(aVals[i][aCE]||'').trim().toLowerCase();
      if (ce) emails.add(ce);
    }
  } else if (audienceKey === 'alloptedin') {
    for (let i=1;i<dVals.length;i++){
      const opt = String(dVals[i][dOpt]||'').toLowerCase();
      const ce = String(dVals[i][dCampus]||'').trim().toLowerCase();
      if (opt === 'yes' && ce) emails.add(ce);
    }
  }

  const people = [];
  for (const ce of emails) {
    const row = byCampus.get(ce);
    if (!row) continue;
    const opt = String(row[dOpt]||'').toLowerCase();
    const phone = row[dPhone];
    if (opt === 'yes' && phone) {
      const name = String(row[dName]||'').trim();
      const firstName = name ? name.split(/\s+/)[0] : '';
      people.push({campusEmail: ce, phone: String(phone), firstName});
    }
  }
  return {people};
}

/***** Event info lookup (matches your row-3 headers) *****/
function getEventInfo_(eventId) {
  const ss = SpreadsheetApp.getActive();
  const log = ss.getSheetByName('Event Log');
  if (!log) return {title:'our event', date:'', location:''};

  const lastCol = log.getLastColumn();
  const lastRow = log.getLastRow();
  if (lastRow < 4) return {title:'our event', date:'', location:''};

  const headers = log.getRange(3,1,1,lastCol).getValues()[0].map(String);
  const data    = log.getRange(4,1,lastRow-3,lastCol).getValues();

  const colId   = headers.indexOf('Event ID');                       // A
  const colDate = headers.indexOf('Date (MM/DD/20YY HH:MM AM/PM)');  // B (your exact header)
  const colLoc  = headers.indexOf('Location');                       // C
  const colT    = headers.indexOf('Public Event Title');             // I

  for (let i=0;i<data.length;i++){
    if (String(data[i][colId]||'').trim() === String(eventId).trim()) {
      const rawDate = colDate >= 0 ? data[i][colDate] : '';
      return {
        title:    colT    >=0 ? data[i][colT]    : 'our event',
        date:     formatEventDate_(rawDate),
        location: colLoc  >=0 ? data[i][colLoc]  : ''
      };
    }
  }
  return {title:'our event', date:'', location:''};
}

/***** Retry failed sends from SMS Log *****/
function resendFailures_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SMS Log');
  if (!sh) return SpreadsheetApp.getUi().alert('No "SMS Log" sheet found.');

  const vals = sh.getDataRange().getValues();
  if (vals.length <= 1) return SpreadsheetApp.getUi().alert('No log entries to retry.');
  const hdrs = vals[0].map(String);
  const cTo   = hdrs.indexOf('To');
  const cBody = hdrs.indexOf('Body');
  const cCode = hdrs.indexOf('HTTP Code');
  const cStat = hdrs.indexOf('Status');
  if (cTo < 0 || cBody < 0) return SpreadsheetApp.getUi().alert('SMS Log missing To/Body headers.');

  let retried = 0;
  for (let r=1; r<vals.length; r++) {
    const to   = vals[r][cTo];
    const body = vals[r][cBody];
    const code = cCode >= 0 ? Number(vals[r][cCode]) : 0;
    const stat = cStat >= 0 ? String(vals[r][cStat]||'') : '';
    const failed = (code >= 400) || (stat && stat.toLowerCase() === 'failed');
    if (!failed || !to || !body) continue;
    sendOneWithControls_(String(to), String(body));
    retried++;
  }
  SpreadsheetApp.getUi().alert(`Retried ${retried} failed sends.`);
}

/***** Tiny ping for auth / smoke-tests *****/
function uiPing() { return 'pong'; }
