# Quick Start: Bulk SMS in 5 Minutes

Get your Twilio bulk SMS system running fast. This is the **minimal setup** guide.

## Prerequisites

- ✅ Google account with Google Sheets access
- ✅ Twilio account with SMS-enabled phone number
- ✅ Twilio Account SID & Auth Token
- ✅ Basic familiarity with Google Apps Script

---

## Step 1: Create Your Sheet (2 min)

1. **Create new Google Sheet** or open existing one
2. **Rename Sheet 1** to `Subscribers` (exact name, case-sensitive)
3. **Add header row** with these column names:

```
phone | opt_in | message | last_sent_at | last_error_code | last_error_message | last_send_status
```

4. **Add test data** (use your own phone number):

| phone | opt_in | message | last_sent_at | last_error_code | last_error_message | last_send_status |
|-------|--------|---------|--------------|-----------------|-------------------|------------------|
| +15551234567 | YES | Hi! Test message | | | | |

> Replace `+15551234567` with your actual phone number in E.164 format

---

## Step 2: Add the Script (1 min)

1. In your Google Sheet: **Extensions → Apps Script**
2. Delete any existing code
3. **Copy entire contents** of `smsBulkSend.js` from this repo
4. **Paste** into Apps Script editor
5. **Save** (Ctrl+S or Cmd+S)
6. **Refresh** your Google Sheet page

You should now see a **📱 Bulk SMS** menu at the top.

---

## Step 3: Configure Twilio (1 min)

1. In Apps Script editor, click **⚙️ Project Settings** (left sidebar)
2. Scroll to **Script Properties** section
3. Click **Add script property**
4. Add these three properties:

| Property | Value | Where to Find |
|----------|-------|---------------|
| `TWILIO_ACCOUNT_SID` | `ACxxxxxxxxx...` | [Twilio Console](https://console.twilio.com) → Dashboard |
| `TWILIO_AUTH_TOKEN` | `your_auth_token` | Twilio Console → Dashboard (click "View" to reveal) |
| `TWILIO_FROM` | `+15551234567` | Twilio Console → Phone Numbers → Active Numbers |

> **Alternative**: Instead of `TWILIO_FROM`, you can use `TWILIO_MESSAGING_SERVICE_SID` if you have a Messaging Service configured

5. Click **Save script properties**

---

## Step 4: Test It! (1 min)

### Method A: Using the Menu (Easiest)

1. Go back to your Google Sheet
2. Click **📱 Bulk SMS → Send Bulk SMS**
3. Authorize the script when prompted (first time only)
4. Check your phone for SMS!

### Method B: Using Apps Script Editor

1. In Apps Script editor, select `sendBulkSMS` from function dropdown
2. Click **Run** ▶️
3. Authorize when prompted
4. Check **Execution log** for results
5. Check your phone for SMS!

---

## Step 5: Verify Results (30 sec)

Check your Google Sheet. The test row should now show:

| phone | opt_in | last_sent_at | last_send_status | last_error_code |
|-------|--------|--------------|------------------|-----------------|
| +15551234567 | YES | 2/2/2026 10:30:00 AM | SENT | |

✅ **Success!** Your bulk SMS system is ready.

---

## Next Steps

### Add Real Subscribers

Add more rows to your `Subscribers` sheet:

```
+12025551111 | YES | Custom message for this person
+12025552222 | YES |
+12025553333 | NO  | (will be skipped)
```

### Run Bulk Send

Just click **📱 Bulk SMS → Send Bulk SMS** again. The script will:
- ✅ Send to all rows with `opt_in = YES`
- ⏭️ Skip rows with `opt_in = NO`
- ⏭️ Skip empty phone numbers
- 🔄 Handle errors without crashing

### Set Up Auto-Resume (For Large Lists)

If you have more than 50 subscribers:

1. **Apps Script editor** → **⏰ Triggers** (clock icon, left sidebar)
2. **+ Add Trigger** (bottom right)
3. Configure:
   - Function: `sendBulkSMS`
   - Event source: **Time-driven**
   - Type: **Minutes timer**
   - Interval: **Every 5 minutes**
4. **Save**

The script will automatically resume where it left off until all messages are sent.

---

## What Happens on Error 21610?

If a recipient has opted out (sent STOP to Twilio):

1. ✅ Script **continues** sending to other numbers (doesn't crash)
2. ✅ Sets that row's `opt_in` to **NO**
3. ✅ Logs error code 21610 in the sheet
4. ✅ Skips that number in future sends

**Example:**

**Before send:**
| phone | opt_in | last_send_status |
|-------|--------|------------------|
| +15551111111 | YES | |
| +15552222222 | YES | (this one opted out) |
| +15553333333 | YES | |

**After send:**
| phone | opt_in | last_send_status | last_error_code |
|-------|--------|------------------|-----------------|
| +15551111111 | YES | SENT | |
| +15552222222 | **NO** | **OPTED_OUT** | **21610** |
| +15553333333 | YES | SENT | |

All three rows processed successfully!

---

## Troubleshooting

### "Missing required columns" error
- Check that all 7 required columns are in row 1
- Column names must match exactly (case-insensitive)

### "Invalid Twilio credentials" error
- Verify Script Properties are set correctly
- Check for typos in Account SID or Auth Token
- Make sure Auth Token wasn't accidentally truncated

### No SMS received
- Check phone number format: Must be **E.164** (`+15551234567`)
- Verify `opt_in` is set to **YES** (not Yes, yes, True, etc.)
- Check Twilio Console → Monitor → Logs for delivery status
- Verify Twilio account has sufficient balance

### Script times out
- Reduce `BATCH_SIZE` in script (default 50)
- Set up time-based trigger (Step 5 above)

---

## Command Reference

| Menu Item | What It Does | When to Use |
|-----------|--------------|-------------|
| **Send Bulk SMS** | Process next batch (50 rows) | After adding subscribers |
| **Reset Cursor** | Start over from row 1 | After editing rows, testing |
| **Test Single SMS** | Test Twilio setup | Initial setup verification |
| **View Logs** | Show execution details | Debugging issues |

---

## Full Documentation

For complete details, see:
- 📄 **[BULK_SMS_SETUP.md](./BULK_SMS_SETUP.md)** - Complete setup guide
- 🔧 **[ERROR_HANDLING_TECHNICAL.md](./ERROR_HANDLING_TECHNICAL.md)** - Implementation details
- 📖 **[README.md](../README.md)** - Project overview

---

## Support

Need help? Check the logs first:

1. **Apps Script editor** → **View → Logs**
2. Or in Google Sheet: **📱 Bulk SMS → View Logs**

Common log messages:
- ✅ `SUCCESS - SMxxxxxxxx` - Message sent
- ⚠️ `ERROR 21610 - Recipient opted out` - Handled gracefully
- ❌ `ERROR 21211 - Invalid phone number` - Check format
- ⏭️ `Skipping - not opted in` - Check opt_in value

---

**You're all set!** 🎉

Your production-ready bulk SMS system is now running. Add subscribers, click send, and watch it handle everything automatically.
