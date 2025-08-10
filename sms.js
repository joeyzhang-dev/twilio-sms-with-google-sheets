/**
 * Google Apps Script: Twilio SMS Core Functions
 * 
 * This script provides core SMS functionality using the Twilio REST API.
 * It handles phone number formatting, SMS sending, and logging.
 * 
 * Features:
 * - Phone number normalization to E.164 format
 * - Twilio API integration for SMS sending
 * - Comprehensive SMS logging
 * - Test functionality
 * 
 * Prerequisites:
 * - Twilio account with Account SID and Auth Token
 * - Messaging Service SID or From Number configured
 * - Script properties set for Twilio credentials
 * 
 * @author Your Organization
 * @version 1.0.0
 */

// =============================================================================
// TWILIO CONFIGURATION
// =============================================================================

/**
 * Retrieve Twilio credentials from script properties
 * @returns {Object} Object containing Twilio configuration
 */
function twilioProps_() {
  const p = PropertiesService.getScriptProperties();
  return {
    sid: p.getProperty('TWILIO_ACCOUNT_SID'),
    token: p.getProperty('TWILIO_AUTH_TOKEN'),
    msid: p.getProperty('TWILIO_MESSAGING_SERVICE_SID'), // Optional, preferred
    from: p.getProperty('TWILIO_FROM_NUMBER')            // Optional if msid is set
  };
}

// =============================================================================
// PHONE NUMBER UTILITIES
// =============================================================================

/**
 * Convert a US phone number to E.164 format (+1XXXXXXXXXX)
 * Handles various input formats and normalizes to standard format
 * 
 * @param {string|number} digits - Phone number in any format
 * @returns {string} Phone number in E.164 format
 */
function toE164_(digits) {
  let d = String(digits || '').replace(/[^\d]/g, '');
  if (d.length === 10) d = '1' + d;    // Add country code if missing
  if (!d.startsWith('1')) d = '1' + d; // Force +1 for US; adjust if non-US
  return '+' + d;
}

// =============================================================================
// SMS SENDING FUNCTIONS
// =============================================================================

/**
 * Send an SMS via Twilio REST API
 * 
 * @param {string} toE164 - Recipient phone number in E.164 format
 * @param {string} body - SMS message body
 * @returns {Object} Twilio API response
 * @throws {Error} If credentials are missing or API call fails
 */
function sendSms_(toE164, body) {
  const { sid, token, msid, from } = twilioProps_();
  
  if (!sid || !token) {
    throw new Error('Missing Twilio credentials (SID/TOKEN). Add Script Properties.');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const payload = { To: toE164, Body: body };

  // Use Messaging Service SID if available, otherwise use From number
  if (msid) {
    payload.MessagingServiceSid = msid;
  } else if (from) {
    payload.From = from;
  } else {
    throw new Error('Provide TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER in Script Properties.');
  }

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    payload,
    headers: { 
      Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) 
    },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const json = JSON.parse(resp.getContentText() || '{}');
  
  // Log the SMS attempt
  logSms_(toE164, body, json.sid || '', code, json.error_message || json.message || '');
  
  if (code < 200 || code >= 300) {
    throw new Error('Twilio error: ' + (json.message || code));
  }
  
  return json;
}

// =============================================================================
// SMS LOGGING
// =============================================================================

/**
 * Log SMS activity to a dedicated sheet
 * Creates "SMS Log" sheet if it doesn't exist
 * 
 * @param {string} to - Recipient phone number
 * @param {string} body - Message body
 * @param {string} sid - Twilio message SID
 * @param {number} httpCode - HTTP response code
 * @param {string} err - Error message if any
 */
function logSms_(to, body, sid, httpCode, err) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SMS Log') || ss.insertSheet('SMS Log');
  
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'To', 'Body', 'Twilio SID', 'HTTP Code', 'Error']);
  }
  
  sh.appendRow([new Date(), to, body, sid, httpCode, err]);
}

// =============================================================================
// TESTING FUNCTIONS
// =============================================================================

/**
 * Send a test SMS to a specific phone number
 * Update the phone number variable for your testing needs
 */
function sendTestSingle() {
  const myPhone = '8162379012'; // Update with your phone number
  sendSms_(toE164_(myPhone), 'Test from Google Sheets. Reply STOP to opt out.');
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Simple ping function for testing
 * @returns {string} Always returns 'pong'
 */
function uiPing_() { 
  return 'pong'; 
}

