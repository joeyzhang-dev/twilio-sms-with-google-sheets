/***** Twilio credentials & helpers *****/
function twilioProps_() {
  const p = PropertiesService.getScriptProperties();
  return {
    sid: p.getProperty('TWILIO_ACCOUNT_SID'),
    token: p.getProperty('TWILIO_AUTH_TOKEN'),
    msid: p.getProperty('TWILIO_MESSAGING_SERVICE_SID'), // optional, preferred
    from: p.getProperty('TWILIO_FROM_NUMBER')            // optional if msid is set
  };
}

// Convert a US 10-digit (or messy) number into E.164 (+1XXXXXXXXXX)
function toE164_(digits) {
  let d = String(digits || '').replace(/[^\d]/g, '');
  if (d.length === 10) d = '1' + d;    // add country code if missing
  if (!d.startsWith('1')) d = '1' + d; // force +1 for US; adjust if non-US
  return '+' + d;
}
function uiPing_() { return 'pong'; }

// Send an SMS via Twilio REST API
// Returns: { success: boolean, data?: object, error?: string, errorCode?: number }
function sendSms_(toE164, body) {
  const { sid, token, msid, from } = twilioProps_();
  if (!sid || !token) {
    return { success: false, error: 'Missing Twilio credentials (SID/TOKEN). Add Script Properties.' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const payload = { To: toE164, Body: body };

  if (msid) payload.MessagingServiceSid = msid;
  else if (from) payload.From = from;
  else {
    return { success: false, error: 'Provide TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER in Script Properties.' };
  }

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload,
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    const json = JSON.parse(resp.getContentText() || '{}');
    
    // Always log the attempt
    logSms_(toE164, body, json.sid || '', code, json.error_message || json.message || '');
    
    // Return result object instead of throwing
    if (code >= 200 && code < 300) {
      return { success: true, data: json };
    } else {
      return { 
        success: false, 
        error: json.message || json.error_message || 'Unknown error',
        errorCode: json.code || code
      };
    }
  } catch (error) {
    // Handle network or parsing errors
    logSms_(toE164, body, '', 0, error.toString());
    return { success: false, error: error.toString() };
  }
}

/***** Simple SMS log sheet *****/
function logSms_(to, body, sid, httpCode, err) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SMS Log') || ss.insertSheet('SMS Log');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp','To','Body','Twilio SID','HTTP Code','Error']);
  }
  sh.appendRow([new Date(), to, body, sid, httpCode, err]);
}

function sendTestSingle() {
  const myPhone = '8162379012'; // your cell
  const result = sendSms_(toE164_(myPhone), 'Test from Google Sheets ✅ Reply STOP to opt out.');
  if (result.success) {
    Logger.log('Test message sent successfully: ' + result.data.sid);
  } else {
    Logger.log('Test message failed: ' + result.error);
  }
  return result;
}

