/**
 * Google Apps Script: SMS Inbound Webhook Handler
 * 
 * This script handles incoming SMS messages via Twilio webhooks.
 * It processes STOP/START/HELP commands and updates student opt-in status.
 * 
 * Features:
 * - Webhook endpoint for Twilio SMS delivery status updates
 * - STOP/START command processing for SMS opt-in management
 * - Automatic student database updates based on phone number
 * - Comprehensive logging of all inbound activity
 * 
 * Webhook URL: Deploy as web app and use the URL as your Twilio webhook
 * 
 * @author Your Organization
 * @version 1.0.0
 */

// =============================================================================
// WEBHOOK ENTRY POINT
// =============================================================================

/**
 * Main webhook handler for Twilio SMS webhooks
 * Processes incoming SMS messages and delivery status updates
 * 
 * @param {Object} e - Event object containing webhook parameters
 * @returns {GoogleAppsScript.Content.TextOutput} TwiML response
 */
function doPost(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const from = String(p.From || '');
  const body = String(p.Body || '').trim();
  const status = String(p.MessageStatus || '');
  const sid = String(p.MessageSid || '');

  // Log all incoming webhook data for debugging
  logInbound_(from, body, status, sid);

  // Handle delivery status callbacks (delivery events)
  if (status) {
    // Already logged above; no additional processing needed
    return twiml_('');
  }

  // Process SMS commands
  const upper = body.toUpperCase();
  const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

  // Handle opt-out commands
  if (STOP_WORDS.includes(upper)) {
    updateOptInByPhone_(from, 'No', { updateAllMatches: true });
    return twiml_(''); // Twilio handles STOP responses automatically
  }
  
  // Handle opt-in commands
  if (upper === 'START') {
    updateOptInByPhone_(from, 'Yes', { updateAllMatches: true });
    return twiml_(''); // Twilio handles START responses automatically
  }
  
  // Handle help requests
  if (upper === 'HELP') {
    // Twilio sends its own HELP text; we stay silent
    return twiml_('');
  }

  // Custom ping command for webhook testing
  if (upper === 'PING') {
    return twiml_('PONG');
  }

  // Default: no reply for unrecognized messages
  return twiml_('');
}

// =============================================================================
// STUDENT DATABASE UPDATES
// =============================================================================

/**
 * Update SMS Opt-In status by phone number
 * 
 * @param {string} fromNumber - Phone number in E.164 format
 * @param {string} value - New opt-in value ('Yes' or 'No')
 * @param {Object} opts - Options object
 * @param {boolean} opts.updateAllMatches - Whether to update all matching records
 * @returns {boolean} True if any records were updated
 */
function updateOptInByPhone_(fromNumber, value, opts) {
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName('Student Database');
  if (!db) return false;

  const vals = db.getDataRange().getValues();
  const hdrs = vals[0].map(String);
  const cPhone = hdrs.indexOf('Phone #');
  const cOpt = hdrs.indexOf('SMS Opt-In');
  
  if (cPhone < 0 || cOpt < 0) return false;

  const want = normalizePhoneDigits_(fromNumber); // Normalize to 10-digit format
  let changed = false;

  for (let r = 1; r < vals.length; r++) {
    const have = normalizePhoneDigits_(vals[r][cPhone]);
    if (have && have === want) {
      db.getRange(r + 1, cOpt + 1).setValue(value);
      changed = true;
      if (!(opts && opts.updateAllMatches)) break; // Stop at first unless asked to update all
    }
  }
  return changed;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Normalize phone number to 10-digit format
 * Removes all non-digits and strips leading US country code
 * 
 * @param {string|number} v - Phone number in any format
 * @returns {string} 10-digit phone number
 */
function normalizePhoneDigits_(v) {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1); // Drop leading US 1
  return d;
}

/**
 * Generate TwiML response for Twilio
 * 
 * @param {string} message - Optional message to include
 * @returns {GoogleAppsScript.Content.TextOutput} TwiML formatted response
 */
function twiml_(message) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
              '<Response>' +
              (message ? ('<Message>' + escapeXml_(message) + '</Message>') : '') +
              '</Response>';
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
}

/**
 * Escape XML special characters
 * 
 * @param {string} s - String to escape
 * @returns {string} XML-escaped string
 */
function escapeXml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// LOGGING
// =============================================================================

/**
 * Log all inbound webhook activity
 * Creates "SMS Log" sheet if it doesn't exist
 * 
 * @param {string} from - Sender phone number
 * @param {string} body - Message body
 * @param {string} status - Delivery status
 * @param {string} sid - Twilio message SID
 */
function logInbound_(from, body, status, sid) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SMS Log') || ss.insertSheet('SMS Log');
  
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'Direction', 'From', 'Body', 'Status', 'MessageSid']);
  }
  
  sh.appendRow([new Date(), 'IN', from, body, status, sid]);
}
