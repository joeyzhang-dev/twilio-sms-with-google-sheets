 /**
 * TWILIO SMS BULK SENDER WITH ROBUST ERROR HANDLING
 * 
 * Production-quality script that:
 * - Sends bulk SMS via Twilio to subscribers in Google Sheets
 * - Handles error 21610 (opt-out) gracefully without stopping execution
 * - Updates opt_in status immediately when 21610 detected
 * - Continues sending to remaining recipients on any error
 * - Implements batching and resume capability for execution time limits
 * - Uses dynamic column detection (no hard-coded indices)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const BULK_SMS_CONFIG = {
  SHEET_NAME: 'Student Database', // Uses your existing sheet
  BATCH_SIZE: 50, // Number of messages to send per execution
  RATE_LIMIT_MS: 200, // Delay between sends (milliseconds)
  
  // Column name mappings: script name -> your sheet's column name
  COLUMN_MAPPINGS: {
    phone: 'Phone #',                    // Your existing column
    opt_in: 'SMS Opt-In',               // Your existing column
    message: 'Message',                 // Optional custom message per row
    last_sent_at: 'Last Sent At',       // Will be added if missing
    last_error_code: 'Last Error Code', // Will be added if missing
    last_error_message: 'Last Error',   // Will be added if missing
    last_send_status: 'Send Status'     // Will be added if missing
  },
  
  DEFAULT_MESSAGE: 'Hello! This is a message from our system.',
  CURSOR_KEY: 'BULK_SMS_CURSOR',
  TWILIO_API_VERSION: '2010-04-01'
};

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main function to send bulk SMS.
 * Call this manually or via time-based trigger.
 */
function sendBulkSMS() {
  try {
    Logger.log('=== BULK SMS SEND START ===');
    
    // Get Twilio credentials
    const credentials = getTwilioCredentials();
    if (!credentials.isValid) {
      throw new Error('Invalid Twilio credentials: ' + credentials.error);
    }
    
    // Get spreadsheet and validate structure
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(BULK_SMS_CONFIG.SHEET_NAME);
    
    if (!sheet) {
      throw new Error(`Sheet "${BULK_SMS_CONFIG.SHEET_NAME}" not found. Please create it first.`);
    }
    
    // Get column mapping
    const columnMap = getColumnMapping(sheet);
    validateColumns(columnMap);
    
    // Get cursor (resume point)
    const cursor = getCursor();
    Logger.log(`Starting from row ${cursor + 1} (cursor: ${cursor})`);
    
    // Get all data
    const dataRange = sheet.getDataRange();
    const allData = dataRange.getValues();
    
    if (allData.length <= 1) {
      Logger.log('No data rows found (only header row)');
      return;
    }
    
    // Process batch
    const result = processBatch(
      sheet,
      allData,
      columnMap,
      credentials,
      cursor
    );
    
    Logger.log(`=== BATCH COMPLETE ===`);
    Logger.log(`Processed: ${result.processed}`);
    Logger.log(`Sent: ${result.sent}`);
    Logger.log(`Skipped: ${result.skipped}`);
    Logger.log(`Failed: ${result.failed}`);
    Logger.log(`Opted Out (21610): ${result.optedOut}`);
    
    if (result.hasMore) {
      Logger.log(`More rows to process. Next cursor: ${result.nextCursor}`);
      Logger.log('Trigger this function again or wait for next scheduled run.');
    } else {
      Logger.log('All rows processed. Resetting cursor.');
      resetCursor();
    }
    
  } catch (error) {
    Logger.log('FATAL ERROR: ' + error.toString());
    throw error;
  }
}

/**
 * Manually reset the cursor to start from the beginning.
 */
function resetBulkSMSCursor() {
  resetCursor();
  Logger.log('Cursor reset. Next run will start from the beginning.');
}

/**
 * Test function to send to a single number.
 */
function testSingleSMS() {
  const credentials = getTwilioCredentials();
  if (!credentials.isValid) {
    Logger.log('Invalid credentials: ' + credentials.error);
    return;
  }
  
  const testPhone = '+1234567890'; // REPLACE WITH TEST NUMBER
  const testMessage = 'Test message from Apps Script';
  
  const result = sendTwilioSMS(
    testPhone,
    testMessage,
    credentials.accountSid,
    credentials.authToken,
    credentials.from,
    credentials.messagingServiceSid
  );
  
  Logger.log('Test result:');
  Logger.log(JSON.stringify(result, null, 2));
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Process a batch of rows, send SMS, and update sheet.
 */
function processBatch(sheet, allData, columnMap, credentials, startCursor) {
  const stats = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    optedOut: 0,
    hasMore: false,
    nextCursor: startCursor
  };
  
  const headerRow = 0;
  const totalRows = allData.length;
  let currentRow = startCursor;
  
  while (currentRow < totalRows && stats.processed < BULK_SMS_CONFIG.BATCH_SIZE) {
    const rowIndex = currentRow;
    const rowData = allData[rowIndex];
    const sheetRowNumber = rowIndex + 1; // Sheet rows are 1-indexed
    
    // Skip header row
    if (rowIndex === headerRow) {
      currentRow++;
      continue;
    }
    
    stats.processed++;
    
    // Extract row values
    const phone = getColumnValue(rowData, columnMap, 'phone');
    const optIn = getColumnValue(rowData, columnMap, 'opt_in');
    const message = getColumnValue(rowData, columnMap, 'message') || BULK_SMS_CONFIG.DEFAULT_MESSAGE;
    
    // Validate phone number
    if (!phone || phone.toString().trim() === '') {
      Logger.log(`Row ${sheetRowNumber}: Skipping - no phone number`);
      stats.skipped++;
      currentRow++;
      continue;
    }
    
    // Check opt-in status
    if (!isOptedIn(optIn)) {
      Logger.log(`Row ${sheetRowNumber}: Skipping ${phone} - not opted in (value: ${optIn})`);
      stats.skipped++;
      currentRow++;
      continue;
    }
    
    // Send SMS
    Logger.log(`Row ${sheetRowNumber}: Sending to ${phone}...`);
    const sendResult = sendTwilioSMS(
      phone,
      message,
      credentials.accountSid,
      credentials.authToken,
      credentials.from,
      credentials.messagingServiceSid
    );
    
    // Update sheet based on result
    if (sendResult.success) {
      Logger.log(`Row ${sheetRowNumber}: SUCCESS - ${sendResult.messageSid}`);
      updateRowSuccess(sheet, sheetRowNumber, columnMap);
      stats.sent++;
      
    } else if (sendResult.errorCode === 21610) {
      Logger.log(`Row ${sheetRowNumber}: ERROR 21610 - Recipient opted out. Updating opt_in to NO.`);
      updateRowOptOut(sheet, sheetRowNumber, columnMap, sendResult);
      stats.optedOut++;
      
    } else {
      Logger.log(`Row ${sheetRowNumber}: ERROR ${sendResult.errorCode} - ${sendResult.errorMessage}`);
      updateRowError(sheet, sheetRowNumber, columnMap, sendResult);
      stats.failed++;
    }
    
    // Rate limiting
    if (stats.processed < BULK_SMS_CONFIG.BATCH_SIZE) {
      Utilities.sleep(BULK_SMS_CONFIG.RATE_LIMIT_MS);
    }
    
    currentRow++;
  }
  
  // Update cursor
  if (currentRow < totalRows) {
    stats.hasMore = true;
    stats.nextCursor = currentRow;
    saveCursor(currentRow);
  } else {
    stats.hasMore = false;
    stats.nextCursor = totalRows;
  }
  
  return stats;
}

// ============================================================================
// TWILIO SMS SENDING
// ============================================================================

/**
 * Send SMS via Twilio REST API.
 * Uses muteHttpExceptions for robust error handling.
 * 
 * @returns {Object} { success: boolean, messageSid?: string, errorCode?: number, errorMessage?: string }
 */
function sendTwilioSMS(to, body, accountSid, authToken, from, messagingServiceSid) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  
  // Build payload - prefer MessagingServiceSid if available
  const payload = {
    To: to,
    Body: body
  };
  
  if (messagingServiceSid) {
    payload.MessagingServiceSid = messagingServiceSid;
  } else if (from) {
    payload.From = from;
  } else {
    return {
      success: false,
      errorCode: 'CONFIG_ERROR',
      errorMessage: 'Neither TWILIO_FROM nor TWILIO_MESSAGING_SERVICE_SID is configured'
    };
  }
  
  // Prepare request
  const options = {
    method: 'post',
    payload: payload,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(accountSid + ':' + authToken)
    },
    muteHttpExceptions: true // CRITICAL: Don't throw on HTTP errors
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    // Parse JSON response
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (parseError) {
      return {
        success: false,
        errorCode: 'JSON_PARSE_ERROR',
        errorMessage: `Failed to parse Twilio response: ${responseText.substring(0, 200)}`
      };
    }
    
    // Check if successful
    if (responseCode === 201 || responseCode === 200) {
      return {
        success: true,
        messageSid: responseJson.sid
      };
    }
    
    // Handle error response
    const errorCode = responseJson.code || responseCode;
    const errorMessage = responseJson.message || responseJson.error_message || 'Unknown error';
    
    return {
      success: false,
      errorCode: errorCode,
      errorMessage: errorMessage
    };
    
  } catch (error) {
    // Network error or other exception
    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: error.toString()
    };
  }
}

// ============================================================================
// SHEET UPDATES
// ============================================================================

/**
 * Update row after successful send.
 */
function updateRowSuccess(sheet, rowNumber, columnMap) {
  const now = new Date();
  
  setColumnValue(sheet, rowNumber, columnMap, 'last_sent_at', now);
  setColumnValue(sheet, rowNumber, columnMap, 'last_send_status', 'SENT');
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_code', '');
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_message', '');
}

/**
 * Update row after error 21610 (opted out).
 * Sets opt_in to NO and logs error details.
 */
function updateRowOptOut(sheet, rowNumber, columnMap, sendResult) {
  const now = new Date();
  
  setColumnValue(sheet, rowNumber, columnMap, 'opt_in', 'NO');
  setColumnValue(sheet, rowNumber, columnMap, 'last_send_status', 'OPTED_OUT');
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_code', sendResult.errorCode);
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_message', sendResult.errorMessage);
  setColumnValue(sheet, rowNumber, columnMap, 'last_sent_at', now);
}

/**
 * Update row after other errors.
 */
function updateRowError(sheet, rowNumber, columnMap, sendResult) {
  const now = new Date();
  
  setColumnValue(sheet, rowNumber, columnMap, 'last_send_status', 'FAILED');
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_code', sendResult.errorCode);
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_message', sendResult.errorMessage);
  setColumnValue(sheet, rowNumber, columnMap, 'last_sent_at', now);
}

// ============================================================================
// COLUMN MAPPING & HELPERS
// ============================================================================

/**
 * Get column indices by reading header row.
 * Returns a map: { scriptColumnName: columnIndex }
 * Matches against your actual sheet column names.
 */
function getColumnMapping(sheet) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columnMap = {};
  
  // Build reverse lookup: actual column name (normalized) -> index
  const actualColumns = {};
  headerRow.forEach((header, index) => {
    const normalized = header.toString().trim().toLowerCase();
    if (normalized) {
      actualColumns[normalized] = index;
    }
  });
  
  // Map script column names to actual column indices
  Object.keys(BULK_SMS_CONFIG.COLUMN_MAPPINGS).forEach(scriptName => {
    const actualName = BULK_SMS_CONFIG.COLUMN_MAPPINGS[scriptName];
    const normalized = actualName.toLowerCase();
    
    if (normalized in actualColumns) {
      columnMap[scriptName] = actualColumns[normalized];
    }
  });
  
  return columnMap;
}

/**
 * Validate that required columns exist, and add missing tracking columns.
 */
function validateColumns(columnMap) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  const requiredBase = ['phone', 'opt_in']; // Must exist
  const trackingCols = ['last_sent_at', 'last_error_code', 'last_error_message', 'last_send_status'];
  
  // Check required base columns
  const missing = [];
  requiredBase.forEach(colName => {
    if (!(colName in columnMap)) {
      missing.push(BULK_SMS_CONFIG.COLUMN_MAPPINGS[colName]);
    }
  });
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required columns in "${CONFIG.SHEET_NAME}" sheet: ${missing.join(', ')}. ` +
      `These columns must exist for the script to work.`
    );
  }
  
  // Auto-add tracking columns if missing
  const lastCol = sheet.getLastColumn();
  let addedCols = [];
  
  trackingCols.forEach(colName => {
    if (!(colName in columnMap)) {
      const actualName = BULK_SMS_CONFIG.COLUMN_MAPPINGS[colName];
      const newColIndex = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColIndex).setValue(actualName);
      columnMap[colName] = newColIndex - 1; // 0-indexed
      addedCols.push(actualName);
      Logger.log(`Added tracking column: ${actualName}`);
    }
  });
  
  if (addedCols.length > 0) {
    Logger.log(`Auto-added ${addedCols.length} tracking columns: ${addedCols.join(', ')}`);
  }
}

/**
 * Get value from row data by script column name.
 */
function getColumnValue(rowData, columnMap, scriptColumnName) {
  const colIndex = columnMap[scriptColumnName];
  if (colIndex === undefined) {
    return null;
  }
  return rowData[colIndex];
}

/**
 * Set value in sheet by script column name.
 */
function setColumnValue(sheet, rowNumber, columnMap, scriptColumnName, value) {
  const colIndex = columnMap[scriptColumnName];
  if (colIndex === undefined) {
    Logger.log(`WARNING: Column mapping "${scriptColumnName}" not found, skipping update`);
    return;
  }
  
  const colLetter = colIndex + 1; // Convert to 1-indexed
  sheet.getRange(rowNumber, colLetter).setValue(value);
}

/**
 * Check if opt-in value means "opted in".
 * Recognizes: yes, YES, true, TRUE, 1, ✓, checked
 */
function isOptedIn(value) {
  if (!value) return false;
  
  const normalized = value.toString().trim().toUpperCase();
  return normalized === 'YES' || 
         normalized === 'TRUE' || 
         normalized === '1' || 
         normalized === 'Y' ||
         normalized === '✓' ||
         normalized === 'CHECKED';
}

// ============================================================================
// CURSOR MANAGEMENT
// ============================================================================

/**
 * Get current cursor position (last processed row index).
 */
function getCursor() {
  const props = PropertiesService.getScriptProperties();
  const cursor = props.getProperty(BULK_SMS_CONFIG.CURSOR_KEY);
  
  // Start from row 1 (0-indexed, so after header row 0)
  return cursor ? parseInt(cursor, 10) : 1;
}

/**
 * Save cursor position.
 */
function saveCursor(position) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(BULK_SMS_CONFIG.CURSOR_KEY, position.toString());
  Logger.log(`Cursor saved at position: ${position}`);
}

/**
 * Reset cursor to beginning.
 */
function resetCursor() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BULK_SMS_CONFIG.CURSOR_KEY);
  Logger.log('Cursor reset to beginning');
}

// ============================================================================
// TWILIO CREDENTIALS
// ============================================================================

/**
 * Get Twilio credentials from Script Properties.
 * Uses your existing Script Property names.
 */
function getTwilioCredentials() {
  const props = PropertiesService.getScriptProperties();
  
  const accountSid = props.getProperty('TWILIO_ACCOUNT_SID');
  const authToken = props.getProperty('TWILIO_AUTH_TOKEN');
  const from = props.getProperty('TWILIO_FROM_NUMBER'); // Your existing property name
  const messagingServiceSid = props.getProperty('TWILIO_MESSAGING_SERVICE_SID');
  
  // Validate required fields
  if (!accountSid || !authToken) {
    return {
      isValid: false,
      error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required in Script Properties'
    };
  }
  
  if (!from && !messagingServiceSid) {
    return {
      isValid: false,
      error: 'Either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID must be set in Script Properties'
    };
  }
  
  return {
    isValid: true,
    accountSid: accountSid,
    authToken: authToken,
    from: from,
    messagingServiceSid: messagingServiceSid
  };
}

// ============================================================================
// MENU & UI
// ============================================================================

/**
 * Add custom menu to spreadsheet.
 * This function is called by the main onOpen() in smsSend.js
 * Or you can call it directly if you want a separate menu.
 */
function onOpenBulkSms_() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📱 Bulk SMS')
    .addItem('Send Bulk SMS (Current Batch)', 'sendBulkSMS')
    .addItem('Reset Cursor (Start Over)', 'resetBulkSMSCursor')
    .addItem('Test Single SMS', 'testSingleSMS')
    .addSeparator()
    .addItem('View Logs', 'showLogs')
    .addToUi();
}

/**
 * Show execution logs in a dialog.
 */
function showLogs() {
  const logs = Logger.getLog();
  const html = HtmlService.createHtmlOutput('<pre>' + logs + '</pre>')
    .setWidth(600)
    .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Execution Logs');
}
