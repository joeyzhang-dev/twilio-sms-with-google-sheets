function doPost(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const from = String(p.From || '');
  const body = String(p.Body || '').trim();
  const status = String(p.MessageStatus || '');
  const sid = String(p.MessageSid || '');

  // Log everything we get (helps confirm Twilio is hitting us)
  logInbound_(from, body, status, sid);

  // Status callbacks (delivery events)
  if (status) {
    // already logged above; nothing else needed
    return twiml_('');
  }

  // Twilio sends default replies for STOP/START/HELP on toll-free.
  // We just update the sheet and return empty.
  const upper = body.toUpperCase();
  const STOP_WORDS = ['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'];

  if (STOP_WORDS.includes(upper)) {
    updateOptInByPhone_(from, 'No', { updateAllMatches: true });
    return twiml_('');
  }
  if (upper === 'START') {
    updateOptInByPhone_(from, 'Yes', { updateAllMatches: true });
    return twiml_('');
  }
  if (upper === 'HELP') {
    // Twilio sends its own HELP text; we stay silent
    return twiml_('');
  }

  // Custom ping to verify your webhook is responding
  if (upper === 'PING') {
    return twiml_('PONG ✅');
  }

  // Default: no reply
  return twiml_('');
}

// Update SMS Opt-In by phone. Options: updateAllMatches to handle duplicates.
function updateOptInByPhone_(fromNumber, value, opts) {
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName('Student Database');
  if (!db) {
    logInbound_('SYSTEM', `No Student Database sheet`, '', '');
    return false;
  }

  const vals = db.getDataRange().getValues();
  if (vals.length < 2) {
    logInbound_('SYSTEM', `Student Database is empty`, '', '');
    return false;
  }

  // Flexible header lookup (case/space tolerant)
  const headers = vals[0].map(h => String(h || ''));
  const findCol = (want) => {
    const target = want.trim().toLowerCase();
    for (let i = 0; i < headers.length; i++) {
      const got = headers[i].trim().toLowerCase();
      if (got === target) return i;
    }
    return -1;
  };

  const cPhone = findCol('phone #');
  const cOpt   = findCol('sms opt-in');

  if (cPhone < 0 || cOpt < 0) {
    logInbound_('SYSTEM',
      `Missing headers. Found phone=${cPhone}, opt=${cOpt}. Expected "Phone #" & "SMS Opt-In".`,
      '', ''
    );
    return false;
  }

  const want = normalizePhoneDigits_(fromNumber); // e.g. 8162379012
  if (!want) {
    logInbound_('SYSTEM', `Invalid inbound From: ${fromNumber}`, '', '');
    return false;
  }

  let changed = false;
  const updateAll = !!(opts && opts.updateAllMatches);
  let matches = 0;

  for (let r = 1; r < vals.length; r++) {
    const have = normalizePhoneDigits_(vals[r][cPhone]);
    if (have && have === want) {
      matches++;
      try {
        db.getRange(r + 1, cOpt + 1).setValue(value);
        changed = true;
      } catch (err) {
        // Protection or write error: log it so you know
        logInbound_('SYSTEM',
          `WRITE FAIL for row ${r+1} phone=${have} -> ${value}: ${err}`,
          '', ''
        );
      }
      if (!updateAll) break;
    }
  }

  if (!matches) {
    logInbound_('SYSTEM', `STOP/START: no row matched phone=${want}`, '', '');
  } else if (changed) {
    logInbound_('SYSTEM', `STOP/START: updated ${updateAll ? matches : 1} row(s) for phone=${want} -> ${value}`, '', '');
  }

  return changed;
}


function normalizePhoneDigits_(v) {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1); // drop leading US 1
  return d;
}

function twiml_(message) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
              '<Response>' +
              (message ? ('<Message>' + escapeXml_(message) + '</Message>') : '') +
              '</Response>';
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
}

function escapeXml_(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;');
}

// Simple inbound log (confirms webhook activity)
function logInbound_(from, body, status, sid) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SMS Log') || ss.insertSheet('SMS Log');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp','Direction','From','Body','Status','MessageSid']);
  }
  sh.appendRow([new Date(), 'IN', from, body, status, sid]);
}
