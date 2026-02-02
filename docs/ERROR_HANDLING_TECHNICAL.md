# Technical Reference: Error 21610 Handling & Resilient Execution

## Architecture Overview

This document explains the technical implementation of robust error handling in the bulk SMS script, with specific focus on Twilio error 21610 (opt-out/unsubscribe).

---

## Core Principle: Never Throw in Main Loop

The script follows this principle: **No exceptions propagate from individual send attempts to the batch processing loop.**

```javascript
// ❌ BAD: This crashes the entire batch
for (const row of rows) {
  sendSMS(row.phone); // Throws on error → loop stops
}

// ✅ GOOD: This continues no matter what
for (const row of rows) {
  const result = sendSMS(row.phone); // Returns result object
  if (!result.success) {
    handleError(result); // Log and update, never throw
  }
}
```

---

## Layer 1: HTTP Request Error Handling

### Problem
By default, `UrlFetchApp.fetch()` throws an exception on HTTP errors (4xx, 5xx status codes).

### Solution
Use `muteHttpExceptions: true`

```javascript
const options = {
  method: 'post',
  payload: payload,
  headers: { Authorization: 'Basic ' + credentials },
  muteHttpExceptions: true  // ← CRITICAL: Don't throw on HTTP errors
};

const response = UrlFetchApp.fetch(url, options);
const responseCode = response.getResponseCode(); // Now safe to check

if (responseCode === 201) {
  // Success path
} else {
  // Error path - handle gracefully
}
```

**Result**: HTTP 400 (Twilio error response) doesn't crash the script.

---

## Layer 2: JSON Parse Error Handling

### Problem
Malformed JSON responses (network issues, Twilio outages) cause `JSON.parse()` to throw.

### Solution
Wrap in try-catch and return error object

```javascript
let responseJson;
try {
  responseJson = JSON.parse(responseText);
} catch (parseError) {
  return {
    success: false,
    errorCode: 'JSON_PARSE_ERROR',
    errorMessage: `Failed to parse response: ${responseText.substring(0, 200)}`
  };
}
```

**Result**: Invalid JSON returns error object instead of crashing.

---

## Layer 3: Network Exception Handling

### Problem
Network failures, DNS issues, timeouts throw exceptions.

### Solution
Wrap entire fetch in try-catch

```javascript
try {
  const response = UrlFetchApp.fetch(url, options);
  // ... process response
} catch (error) {
  return {
    success: false,
    errorCode: 'NETWORK_ERROR',
    errorMessage: error.toString()
  };
}
```

**Result**: Network failures return error object instead of crashing.

---

## Layer 4: Error Classification

### Implementation

```javascript
// Parse Twilio error response
const errorCode = responseJson.code || responseCode;
const errorMessage = responseJson.message || 'Unknown error';

return {
  success: false,
  errorCode: errorCode,        // 21610, 21211, etc.
  errorMessage: errorMessage   // Human-readable description
};
```

### Error Code Examples

| Error Code | Meaning | Action Taken |
|------------|---------|--------------|
| 21610 | Recipient opted out (STOP) | Set opt_in=NO, continue |
| 21211 | Invalid phone number | Log error, continue |
| 21408 | Permission not granted | Log error, continue |
| 21606 | Landline/unreachable | Log error, continue |
| 30007 | Message filtered (spam) | Log error, continue |
| NETWORK_ERROR | Network/timeout | Log error, continue |

**Key Point**: Script handles ALL error codes the same way (log and continue), but 21610 gets **special treatment** (also sets opt_in=NO).

---

## Layer 5: Batch Processing Loop

### Implementation

```javascript
while (currentRow < totalRows && stats.processed < CONFIG.BATCH_SIZE) {
  const rowData = allData[currentRow];
  
  // Extract data
  const phone = getColumnValue(rowData, columnMap, 'phone');
  const optIn = getColumnValue(rowData, columnMap, 'opt_in');
  
  // Pre-validation (skip without sending)
  if (!phone || !isOptedIn(optIn)) {
    stats.skipped++;
    currentRow++;
    continue; // Safe: just skip to next row
  }
  
  // Send SMS - NEVER throws
  const sendResult = sendTwilioSMS(phone, message, credentials);
  
  // Handle result - NEVER throws
  if (sendResult.success) {
    updateRowSuccess(sheet, rowNumber, columnMap);
    stats.sent++;
  } else if (sendResult.errorCode === 21610) {
    updateRowOptOut(sheet, rowNumber, columnMap, sendResult);
    stats.optedOut++;
  } else {
    updateRowError(sheet, rowNumber, columnMap, sendResult);
    stats.failed++;
  }
  
  // Rate limiting
  Utilities.sleep(CONFIG.RATE_LIMIT_MS);
  
  currentRow++;
  // Loop continues regardless of result
}
```

**Key Points**:
1. Every code path leads to `currentRow++`
2. No `throw` statements inside loop
3. All errors handled with if/else, not try/catch
4. Stats tracked but don't affect flow

---

## Error 21610 Specific Handling

### Detection

```javascript
if (sendResult.errorCode === 21610) {
  // Opt-out detected
}
```

### Special Actions

```javascript
function updateRowOptOut(sheet, rowNumber, columnMap, sendResult) {
  // 1. Flip opt-in flag
  setColumnValue(sheet, rowNumber, columnMap, 'opt_in', 'NO');
  
  // 2. Mark status
  setColumnValue(sheet, rowNumber, columnMap, 'last_send_status', 'OPTED_OUT');
  
  // 3. Record error details
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_code', 21610);
  setColumnValue(sheet, rowNumber, columnMap, 'last_error_message', sendResult.errorMessage);
  
  // 4. Timestamp
  setColumnValue(sheet, rowNumber, columnMap, 'last_sent_at', new Date());
  
  // CRITICAL: This function NEVER throws
}
```

### Why This Matters

```javascript
// Next run of the script
if (!isOptedIn(optIn)) {  // Checks for YES/true/1
  stats.skipped++;
  continue;  // Won't attempt to send again
}
```

**Result**: Number with opt_in=NO is permanently skipped in future runs.

---

## Dynamic Column Mapping

### Problem
Hard-coded column indices break when columns are reordered or added.

### Solution
Build column map from header row

```javascript
function getColumnMapping(sheet) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columnMap = {};
  
  headerRow.forEach((header, index) => {
    const normalized = header.toString().trim().toLowerCase();
    if (normalized) {
      columnMap[normalized] = index;
    }
  });
  
  return columnMap; // { phone: 0, opt_in: 1, ... }
}
```

### Usage

```javascript
// Read value
const phone = rowData[columnMap['phone']];

// Write value
const colIndex = columnMap['opt_in'];
sheet.getRange(rowNumber, colIndex + 1).setValue('NO');
```

**Result**: Columns can be in any order, script adapts automatically.

---

## Resume/Cursor Mechanism

### Problem
Apps Script has 6-minute execution limit. Large batches can't complete in one run.

### Solution
Store progress in PropertiesService

```javascript
function saveCursor(position) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('BULK_SMS_CURSOR', position.toString());
}

function getCursor() {
  const props = PropertiesService.getScriptProperties();
  const cursor = props.getProperty('BULK_SMS_CURSOR');
  return cursor ? parseInt(cursor, 10) : 1; // Start at row 1 (after header)
}
```

### Flow

```
Run 1: Process rows 1-50   → Save cursor at 51
Run 2: Process rows 51-100 → Save cursor at 101
Run 3: Process rows 101-120 → Complete, reset cursor
```

**Result**: Time-based trigger can automatically resume processing.

---

## Rate Limiting

### Implementation

```javascript
// After each send (except last in batch)
if (stats.processed < CONFIG.BATCH_SIZE) {
  Utilities.sleep(CONFIG.RATE_LIMIT_MS); // Default: 200ms
}
```

### Why It Matters
- Twilio default rate limit: ~1 message/second per phone number
- Without delay: Risk of 429 (Too Many Requests) errors
- With 200ms delay: ~5 messages/second (safe)

**Result**: Prevents rate limiting without sacrificing too much speed.

---

## Error Propagation Summary

```
User Phone Number
       ↓
Pre-validation (skip if invalid/opted-out)
       ↓
sendTwilioSMS() → Returns { success, errorCode, errorMessage }
       ↓
Classification
       ├─→ Success → updateRowSuccess() → Continue
       ├─→ Error 21610 → updateRowOptOut() → Continue
       └─→ Other error → updateRowError() → Continue
       ↓
Rate limit delay
       ↓
Next row

NO EXCEPTIONS THROWN AT ANY STEP
```

---

## Testing Error Conditions

### Test 21610 Locally

```javascript
// Mock function for testing (replace sendTwilioSMS temporarily)
function mockSendTwilioSMS_21610(to, body, creds) {
  return {
    success: false,
    errorCode: 21610,
    errorMessage: 'The recipient has opted out of messages sent from this number'
  };
}
```

### Test Other Errors

```javascript
function mockSendTwilioSMS_InvalidNumber(to, body, creds) {
  return {
    success: false,
    errorCode: 21211,
    errorMessage: 'Invalid To phone number'
  };
}
```

### Test Network Error

```javascript
function mockSendTwilioSMS_NetworkError(to, body, creds) {
  return {
    success: false,
    errorCode: 'NETWORK_ERROR',
    errorMessage: 'DNS error: could not resolve host'
  };
}
```

**Usage**: Replace real function in test scenarios to verify error handling.

---

## Performance Characteristics

### Typical Batch (50 messages)

```
Pre-checks: ~50ms
Sends: 50 × (200ms API + 200ms delay) = 20 seconds
Sheet updates: ~500ms
Total: ~21 seconds
```

### With Errors

```
10 errors with 21610: Same time (errors don't slow down)
Sheet updates: 10 additional column writes = +100ms
Total impact: Negligible
```

**Key Point**: Error handling adds minimal overhead. Script runs at same speed whether all succeed or all fail.

---

## Security Considerations

### Credentials
- Stored in PropertiesService (encrypted at rest)
- Never logged or exposed in sheets
- Transmitted via HTTPS (TLS 1.2+)
- Basic auth (base64) standard for Twilio

### Error Messages
- Full error messages written to sheet (may contain phone validation hints)
- Logs contain phone numbers (be careful with sharing logs)

### Recommendations
- Restrict sheet access to authorized users
- Use Messaging Service SID over FROM number (better for compliance)
- Regularly audit Script Properties

---

## Debugging Tips

### Enable Verbose Logging

```javascript
// Add after each major step
Logger.log(`Row ${rowNumber}: Phone=${phone}, OptIn=${optIn}, Result=${JSON.stringify(result)}`);
```

### Track Specific Error Codes

```javascript
// Add in processBatch
const errorCodeStats = {};
// ... in loop ...
if (!sendResult.success) {
  errorCodeStats[sendResult.errorCode] = (errorCodeStats[sendResult.errorCode] || 0) + 1;
}
// ... at end ...
Logger.log('Error code breakdown: ' + JSON.stringify(errorCodeStats));
```

### Test Single Row

```javascript
function debugSingleRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const columnMap = getColumnMapping(sheet);
  const rowData = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  Logger.log('Column Map: ' + JSON.stringify(columnMap));
  Logger.log('Row Data: ' + JSON.stringify(rowData));
  Logger.log('Phone: ' + getColumnValue(rowData, columnMap, 'phone'));
  Logger.log('OptIn: ' + getColumnValue(rowData, columnMap, 'opt_in'));
}
```

---

## Comparison: Before & After

### ❌ Fragile Implementation

```javascript
// Crashes on first error
function sendBulk() {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const phone = rows[i][0]; // Hard-coded index
    const result = UrlFetchApp.fetch(url, options); // Throws on error
    // Never gets past first error
  }
}
```

### ✅ Resilient Implementation

```javascript
// Handles all errors gracefully
function sendBulk() {
  const columnMap = getColumnMapping(sheet); // Dynamic
  for (let i = 1; i < rows.length; i++) {
    const phone = getColumnValue(rows[i], columnMap, 'phone'); // Safe
    const result = sendTwilioSMS(phone, msg, creds); // Returns object
    if (result.success) {
      updateSuccess();
    } else if (result.errorCode === 21610) {
      updateOptOut(); // Special handling
    } else {
      updateError(); // General handling
    }
    // Always continues to next row
  }
}
```

---

## Conclusion

The script achieves resilient execution through:

1. **muteHttpExceptions**: HTTP errors don't throw
2. **Try-catch JSON parsing**: Malformed responses handled
3. **Network exception handling**: Connection failures return error objects
4. **No throws in main loop**: All errors handled with conditionals
5. **Error 21610 special case**: Detected by code, triggers opt-out update
6. **Continue statement**: Always advances to next row
7. **Result objects**: Success/failure communicated via return values, not exceptions

**Result**: Script processes every single row, updating the sheet accurately, regardless of errors encountered.
