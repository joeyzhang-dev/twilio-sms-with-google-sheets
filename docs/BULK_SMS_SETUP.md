# Bulk SMS Setup & Usage Guide

## Overview

This production-quality script sends bulk SMS messages via Twilio to subscribers listed in a Google Sheet. It includes robust error handling that **never crashes** due to individual phone number issues, including Twilio error 21610 (recipient opted out).

## Key Features

✅ **Error 21610 Handling**: Automatically marks opted-out numbers and continues sending  
✅ **Resilient Execution**: Continues processing all rows even when errors occur  
✅ **Dynamic Column Detection**: No hard-coded column positions  
✅ **Batch Processing**: Handles execution time limits with automatic resume  
✅ **Rate Limiting**: Prevents API throttling  
✅ **Comprehensive Logging**: Tracks success, failures, and opt-outs per row

---

## Setup Instructions

### Step 1: Create Your Google Sheet

1. Create or open your Google Spreadsheet
2. Create a sheet named **`Subscribers`** (exact name, case-sensitive)
3. Add the following columns in **row 1** (header row):

| Column Name | Type | Required | Description |
|-------------|------|----------|-------------|
| `phone` | Text | ✅ Yes | Phone number in E.164 format (+1234567890) |
| `opt_in` | Text | ✅ Yes | Values: YES, NO, true, false, 1, 0 |
| `message` | Text | ❌ No | Custom message (uses default if empty) |
| `last_sent_at` | Date/Time | ✅ Yes | Timestamp of last send attempt |
| `last_error_code` | Text/Number | ✅ Yes | Twilio error code (e.g., 21610) |
| `last_error_message` | Text | ✅ Yes | Error message from Twilio |
| `last_send_status` | Text | ✅ Yes | SENT, FAILED, OPTED_OUT |

**Example sheet structure:**

| phone | opt_in | message | last_sent_at | last_error_code | last_error_message | last_send_status |
|-------|--------|---------|--------------|-----------------|-------------------|------------------|
| +15551234567 | YES | Hello! | | | | |
| +15559876543 | YES | | | | | |
| +15555555555 | NO | | | | | |

> **Note**: Column order doesn't matter! The script finds columns by name.

### Step 2: Configure Script Properties

1. In Apps Script editor, go to **Project Settings** (⚙️ icon)
2. Scroll to **Script Properties**
3. Add the following properties:

| Property Name | Value | Required | Notes |
|---------------|-------|----------|-------|
| `TWILIO_ACCOUNT_SID` | Your Account SID | ✅ Yes | From Twilio Console |
| `TWILIO_AUTH_TOKEN` | Your Auth Token | ✅ Yes | From Twilio Console |
| `TWILIO_FROM` | +1234567890 | ⚠️ Either this OR MessagingServiceSid | Your Twilio phone number |
| `TWILIO_MESSAGING_SERVICE_SID` | MGXXXXXXX | ⚠️ Either this OR FROM | Your Messaging Service SID |

**Where to find these values:**
- Log into [Twilio Console](https://console.twilio.com/)
- Account SID & Auth Token: Dashboard home page
- FROM number: Phone Numbers → Manage → Active numbers
- Messaging Service SID: Messaging → Services

> **Recommendation**: Use `TWILIO_MESSAGING_SERVICE_SID` if you have one configured. The script prefers it over FROM number.

### Step 3: Add the Script to Your Project

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Create a new file: **File → New → Script file**
3. Name it `smsBulkSend`
4. Paste the entire contents of `smsBulkSend.js`
5. Click **Save** (💾)

### Step 4: Test the Setup

1. In your `Subscribers` sheet, add **one test row** with:
   - Your own phone number (in E.164 format)
   - `opt_in` = YES
   - A test message (or leave empty for default)

2. In Apps Script editor, run the function:
   - Select `sendBulkSMS` from dropdown
   - Click **Run** ▶️
   - Authorize the script if prompted

3. Check the **Execution log** (View → Logs) for results

4. Check your phone for the SMS

5. Check the sheet row - it should be updated with:
   - `last_sent_at`: Current timestamp
   - `last_send_status`: SENT
   - Cleared error fields

### Step 5: Set Up Automatic Trigger (Optional but Recommended)

For large batches that exceed execution time limits:

1. In Apps Script editor: **Triggers** (⏰ clock icon in left sidebar)
2. Click **+ Add Trigger** (bottom right)
3. Configure:
   - **Choose function**: `sendBulkSMS`
   - **Deployment**: Head
   - **Event source**: Time-driven
   - **Type**: Minutes timer
   - **Interval**: Every 5 minutes (or your preference)
4. Click **Save**

**How it works:**
- First run processes rows 1-50 (configurable batch size)
- Saves cursor position
- Next trigger picks up from row 51
- Continues until all rows processed
- Automatically resets when complete

---

## How Error 21610 is Handled

### What Happens When 21610 Occurs:

1. **SMS Send Attempt**: Script tries to send to a number
2. **Twilio Response**: Returns error code 21610 (recipient unsubscribed/STOP)
3. **Immediate Actions**:
   - ✅ Sets `opt_in` column to **NO** for that row
   - ✅ Writes `last_error_code` = 21610
   - ✅ Writes `last_error_message` from Twilio
   - ✅ Sets `last_send_status` = OPTED_OUT
   - ✅ Records timestamp in `last_sent_at`
4. **Continues Execution**: Script moves to next row **without throwing error**
5. **Future Sends**: This number will be skipped (opt_in = NO)

### Why It Never Crashes:

1. **`muteHttpExceptions: true`**: UrlFetchApp doesn't throw on HTTP errors
2. **Robust JSON Parsing**: Wrapped in try-catch to handle malformed responses
3. **Per-Row Error Handling**: Each send attempt is isolated
4. **Defensive Checks**: Validates phone, opt-in status before sending
5. **Continue Loop**: No `throw` statements in main processing loop

### Example Scenario:

**Before send:**
| phone | opt_in | last_send_status |
|-------|--------|------------------|
| +15551111111 | YES | |
| +15552222222 | YES | |
| +15553333333 | YES | |

**After send (middle number opted out):**
| phone | opt_in | last_send_status | last_error_code | last_error_message |
|-------|--------|------------------|-----------------|-------------------|
| +15551111111 | YES | SENT | | |
| +15552222222 | **NO** | **OPTED_OUT** | **21610** | **The recipient has opted out** |
| +15553333333 | YES | SENT | | |

✅ All three rows processed, opt-out recorded, execution completed successfully.

---

## Configuration Options

Edit these constants in `smsBulkSend.js`:

```javascript
const CONFIG = {
  SHEET_NAME: 'Subscribers',        // Name of sheet to process
  BATCH_SIZE: 50,                   // Messages per execution
  RATE_LIMIT_MS: 200,               // Delay between sends (ms)
  DEFAULT_MESSAGE: 'Hello! ...',    // Used when message column empty
  // ... other settings
};
```

**Recommendations:**
- `BATCH_SIZE`: 50-200 (balance between completion and time limits)
- `RATE_LIMIT_MS`: 200-1000 (avoid rate limiting, Twilio default is ~1/sec)

---

## Test Plan

### Test 1: Successful Send
**Goal**: Verify normal send works and updates sheet correctly

1. Add row: `+15551234567, YES, Test message`
2. Run `sendBulkSMS`
3. **Expected**:
   - SMS received on phone
   - `last_send_status` = SENT
   - `last_sent_at` has timestamp
   - `last_error_code` and `last_error_message` are empty

### Test 2: Error 21610 (Opted Out)
**Goal**: Verify opt-out is detected and recorded without crashing

1. Find a number that's opted out (or use Twilio test number)
2. Add row: `+15550000001, YES, Test` (use opted-out number)
3. Run `sendBulkSMS`
4. **Expected**:
   - `opt_in` changed to **NO**
   - `last_send_status` = OPTED_OUT
   - `last_error_code` = 21610
   - `last_error_message` contains "opted out" text
   - Script completed without error
   - Logs show "ERROR 21610" but execution continues

### Test 3: Invalid Phone Number
**Goal**: Verify invalid numbers don't crash execution

1. Add row: `+1999, YES, Test`
2. Add another valid row after it
3. Run `sendBulkSMS`
4. **Expected**:
   - First row: `last_send_status` = FAILED, error logged
   - Second row: `last_send_status` = SENT (script continued!)
   - Script completed successfully

### Test 4: Batch Processing & Resume
**Goal**: Verify cursor works for large batches

1. Add 55 rows with valid numbers (if BATCH_SIZE = 50)
2. Run `sendBulkSMS` once
3. **Expected**:
   - First 50 rows processed
   - Logs show "More rows to process"
4. Run `sendBulkSMS` again
5. **Expected**:
   - Remaining 5 rows processed
   - Logs show "All rows processed. Resetting cursor."

### Test 5: Skip Opt-Out Numbers
**Goal**: Verify opted-out numbers are skipped

1. Add row: `+15551234567, NO, Test`
2. Run `sendBulkSMS`
3. **Expected**:
   - Logs show "Skipping - not opted in"
   - No send attempt
   - No SMS received
   - Row not updated

---

## Troubleshooting

### "Missing required columns" error
- **Cause**: Sheet doesn't have all required headers
- **Fix**: Add missing columns to row 1 (exact names from setup)

### "Invalid Twilio credentials" error
- **Cause**: Script Properties not set or incorrect
- **Fix**: Check Project Settings → Script Properties, verify values

### "Neither TWILIO_FROM nor TWILIO_MESSAGING_SERVICE_SID is configured"
- **Cause**: Missing sender configuration
- **Fix**: Add at least one of these to Script Properties

### Messages not sending
- **Check**: 
  1. `opt_in` column is YES/true/1
  2. Phone numbers in E.164 format (+1234567890)
  3. Twilio account has funds
  4. Check execution logs for specific errors

### Execution timeout
- **Cause**: Too many rows for single execution
- **Fix**: 
  1. Reduce `BATCH_SIZE` in config
  2. Set up time-based trigger (Step 5)
  3. Script will resume automatically

### Rate limiting errors (429)
- **Cause**: Sending too fast
- **Fix**: Increase `RATE_LIMIT_MS` to 500-1000

---

## Menu Functions

After opening the spreadsheet, look for **📱 Bulk SMS** menu:

| Menu Item | Function | Use Case |
|-----------|----------|----------|
| **Send Bulk SMS** | `sendBulkSMS()` | Process next batch of messages |
| **Reset Cursor** | `resetBulkSMSCursor()` | Start over from row 1 |
| **Test Single SMS** | `testSingleSMS()` | Test credentials (edit number in code) |
| **View Logs** | `showLogs()` | See execution details in dialog |

---

## Additional Notes

### Phone Number Format
Always use **E.164 format**: `+[country code][number]`
- ✅ `+12025551234` (USA)
- ✅ `+442071234567` (UK)
- ❌ `(202) 555-1234`
- ❌ `202-555-1234`

### Execution Limits
Apps Script limits:
- **6 minutes** per execution (consumer accounts)
- **30 minutes** per day (consumer accounts)
- Use time-based triggers to spread load

### Security
- **Never** commit Script Properties to version control
- Auth Token is sensitive - treat like a password
- Consider using environment-specific properties

### Monitoring
Check regularly:
- Execution logs (Apps Script → Executions)
- Twilio Console → Monitor → Logs
- Sheet `last_error_code` column for patterns

---

## Support

If you encounter issues:
1. Check execution logs first
2. Verify Twilio credentials in Console
3. Test with `testSingleSMS()` function
4. Review phone number format
5. Check Twilio account balance

## License

MIT License - See LICENSE file for details
