# Setup Checklist: Bulk SMS System

Use this checklist to ensure your bulk SMS system is configured correctly. Check off each item as you complete it.

---

## ☐ Phase 1: Google Sheet Setup (5 minutes)

### ☐ 1.1 Create or Open Google Sheet
- [ ] Google Sheet opened in browser
- [ ] You have edit access to the sheet

### ☐ 1.2 Create Subscribers Sheet
- [ ] Sheet tab named exactly `Subscribers` (case-sensitive)
- [ ] Sheet is active and visible

### ☐ 1.3 Add Required Columns (Row 1)
Add these exact column names in row 1 (order doesn't matter):

- [ ] `phone`
- [ ] `opt_in`
- [ ] `message`
- [ ] `last_sent_at`
- [ ] `last_error_code`
- [ ] `last_error_message`
- [ ] `last_send_status`

**Verification:** All 7 columns present in row 1? ✓

### ☐ 1.4 Add Test Data (Row 2)
- [ ] Your phone number in `phone` column (E.164 format: +15551234567)
- [ ] `YES` in `opt_in` column
- [ ] Test message in `message` column (or leave empty)
- [ ] Other columns can be empty

**Verification:** Can you see your test row? ✓

---

## ☐ Phase 2: Apps Script Setup (3 minutes)

### ☐ 2.1 Open Apps Script Editor
- [ ] In Google Sheet: Extensions → Apps Script
- [ ] Apps Script editor opened in new tab
- [ ] Project name visible at top

### ☐ 2.2 Add Script File
- [ ] Created new script file: File → New → Script file
- [ ] Named file `smsBulkSend`
- [ ] Deleted any existing default code

### ☐ 2.3 Paste Script Code
- [ ] Copied entire contents of `smsBulkSend.js` from repo
- [ ] Pasted into Apps Script editor
- [ ] No syntax errors visible (no red underlines)

### ☐ 2.4 Save Script
- [ ] Clicked Save button (💾) or pressed Ctrl+S / Cmd+S
- [ ] "Saving..." message appeared and completed
- [ ] No error message appeared

**Verification:** Script code visible and saved? ✓

---

## ☐ Phase 3: Twilio Configuration (2 minutes)

### ☐ 3.1 Gather Twilio Credentials
Log into [Twilio Console](https://console.twilio.com/)

- [ ] Copied Account SID (starts with AC...)
- [ ] Copied Auth Token (click "View" to reveal)
- [ ] Copied FROM phone number (starts with +1...) OR
- [ ] Copied Messaging Service SID (starts with MG...)

**Verification:** You have at least 3 of these 4 values? ✓

### ☐ 3.2 Add Script Properties
In Apps Script editor:
- [ ] Clicked ⚙️ Project Settings (left sidebar)
- [ ] Scrolled to "Script Properties" section
- [ ] Clicked "Add script property"

Add these properties:

**Required:**
- [ ] Property: `TWILIO_ACCOUNT_SID`, Value: (your Account SID)
- [ ] Property: `TWILIO_AUTH_TOKEN`, Value: (your Auth Token)

**At least one required:**
- [ ] Property: `TWILIO_FROM`, Value: (your +1... phone number) OR
- [ ] Property: `TWILIO_MESSAGING_SERVICE_SID`, Value: (your MG... SID)

- [ ] Clicked "Save script properties"

**Verification:** All properties visible in list? ✓

---

## ☐ Phase 4: First Test (2 minutes)

### ☐ 4.1 Refresh Google Sheet
- [ ] Returned to Google Sheet tab
- [ ] Pressed F5 or clicked browser refresh
- [ ] Waited for sheet to fully load (2-3 seconds)

### ☐ 4.2 Verify Menu Appears
- [ ] Menu bar shows: File, Edit, View, Insert, Format, Data, Tools, Extensions, Help
- [ ] **AND** new menu: **📱 Bulk SMS**
- [ ] Clicked 📱 Bulk SMS menu
- [ ] Dropdown shows: "Send Bulk SMS", "Reset Cursor", "Test Single SMS", "View Logs"

**Verification:** Custom menu visible? ✓

If menu doesn't appear:
- Wait 10 more seconds and check again
- Try refreshing one more time
- Check Apps Script editor for save errors

### ☐ 4.3 Run First Send
- [ ] Clicked **📱 Bulk SMS → Send Bulk SMS**
- [ ] Authorization popup appeared (first time only)
- [ ] Clicked through authorization screens
- [ ] Selected your Google account
- [ ] Clicked "Allow" to grant permissions
- [ ] Popup closed automatically

**Verification:** No error message appeared? ✓

### ☐ 4.4 Check Your Phone
- [ ] SMS received within 30 seconds
- [ ] Message matches what you put in sheet (or default message)
- [ ] Message came from your Twilio number

**Verification:** SMS received? ✓

### ☐ 4.5 Check Sheet Updates
Go back to your Google Sheet and check row 2:

- [ ] `last_sent_at` has a timestamp (e.g., "2/2/2026 10:30:00 AM")
- [ ] `last_send_status` = "SENT"
- [ ] `last_error_code` is empty
- [ ] `last_error_message` is empty

**Verification:** All four fields updated correctly? ✓

---

## ☐ Phase 5: Verify Logs (1 minute)

### ☐ 5.1 Check Apps Script Logs
- [ ] In Apps Script editor: View → Logs (or Ctrl+Enter)
- [ ] Logs window opened
- [ ] See messages like:
  - `=== BULK SMS SEND START ===`
  - `Starting from row...`
  - `Row 2: Sending to +1...`
  - `Row 2: SUCCESS - SM...`
  - `Sent: 1`

**Verification:** Logs show successful send? ✓

### ☐ 5.2 Or Check via Sheet Menu
- [ ] In Google Sheet: **📱 Bulk SMS → View Logs**
- [ ] Dialog window opened showing logs
- [ ] Same log messages visible

**Verification:** Can view logs from sheet? ✓

---

## ☐ Phase 6: Test Error 21610 Handling (Optional, 5 minutes)

**Warning:** This test requires a number that's opted out of your Twilio messages.

### ☐ 6.1 Add Opted-Out Number
- [ ] Added new row with a number you've previously sent STOP to
- [ ] OR used Twilio test number that returns 21610
- [ ] Set `opt_in` = YES for this row
- [ ] Set `message` = "Test 21610"

### ☐ 6.2 Run Send
- [ ] Clicked **📱 Bulk SMS → Send Bulk SMS**
- [ ] Waited for execution to complete
- [ ] No error popup appeared

### ☐ 6.3 Verify Error Handling
Check the opted-out number's row:

- [ ] `opt_in` changed from YES to **NO**
- [ ] `last_send_status` = "OPTED_OUT"
- [ ] `last_error_code` = 21610
- [ ] `last_error_message` contains "opted out" or similar text
- [ ] `last_sent_at` has timestamp

**Verification:** Opt-out detected and recorded? ✓

### ☐ 6.4 Verify Other Rows Still Sent
If you had other rows with opt_in=YES:

- [ ] Those rows have `last_send_status` = "SENT"
- [ ] Script didn't crash or stop processing

**Verification:** Script continued after 21610 error? ✓

---

## ☐ Phase 7: Production Setup (Optional, 3 minutes)

### ☐ 7.1 Configure Batch Size (Optional)
If you have more than 50 subscribers:

- [ ] Opened `smsBulkSend.js` in Apps Script editor
- [ ] Found `CONFIG` object at top
- [ ] Changed `BATCH_SIZE: 50` to desired value (e.g., 100)
- [ ] Saved script

### ☐ 7.2 Configure Rate Limiting (Optional)
If you're getting rate limit errors:

- [ ] In `CONFIG` object, found `RATE_LIMIT_MS: 200`
- [ ] Changed to higher value (e.g., 500 or 1000)
- [ ] Saved script

### ☐ 7.3 Set Up Auto-Resume Trigger (Recommended for 50+ rows)
For automatic batch processing:

- [ ] In Apps Script editor: Clicked ⏰ Triggers (clock icon, left sidebar)
- [ ] Clicked **+ Add Trigger** (bottom right)
- [ ] Selected function: `sendBulkSMS`
- [ ] Event source: **Time-driven**
- [ ] Type: **Minutes timer**
- [ ] Interval: **Every 5 minutes** (or your preference)
- [ ] Clicked **Save**
- [ ] Trigger appears in list

**Verification:** Trigger visible and enabled? ✓

---

## ☐ Phase 8: Production Data (When Ready)

### ☐ 8.1 Add Real Subscribers
- [ ] Deleted test row (or set opt_in=NO)
- [ ] Added real subscriber data starting at row 2
- [ ] All phone numbers in E.164 format (+1...)
- [ ] All opt_in values set to YES or NO
- [ ] Message column filled (or left empty for default)

### ☐ 8.2 Double-Check Data Quality
- [ ] All phone numbers validated (correct format)
- [ ] No duplicate numbers
- [ ] All opt_in values are YES or NO (not blank)
- [ ] Verified recipients actually opted in (compliance!)

### ☐ 8.3 Run Production Send
- [ ] Clicked **📱 Bulk SMS → Reset Cursor** (if testing before)
- [ ] Clicked **📱 Bulk SMS → Send Bulk SMS**
- [ ] Monitored execution logs
- [ ] Checked sheet for status updates

**Verification:** Production messages sending correctly? ✓

---

## Troubleshooting Quick Reference

### Issue: "Missing required columns" error
**Solution:** Check spelling of column names in row 1. Must match exactly:
- phone, opt_in, message, last_sent_at, last_error_code, last_error_message, last_send_status

### Issue: "Invalid Twilio credentials" error
**Solution:** 
1. Go to Apps Script → ⚙️ Project Settings → Script Properties
2. Verify TWILIO_ACCOUNT_SID starts with "AC"
3. Verify TWILIO_AUTH_TOKEN is 32 characters
4. Verify you have either TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID

### Issue: Menu doesn't appear
**Solution:**
1. Wait 10 seconds after refreshing
2. Check Apps Script editor - make sure script is saved
3. Try opening sheet in incognito/private window
4. Check console for errors (F12 → Console tab)

### Issue: No SMS received
**Solution:**
1. Check phone number format (must be +15551234567, not (555) 123-4567)
2. Check opt_in = YES (case insensitive)
3. Check Twilio Console → Monitor → Logs for delivery status
4. Verify Twilio account has funds and phone number is SMS-enabled

### Issue: Execution timeout
**Solution:**
1. Reduce BATCH_SIZE in CONFIG (try 25 or 30)
2. Set up time-based trigger (Phase 7.3)
3. Script will automatically resume on next run

---

## Final Verification Checklist

Before going to production, verify:

- [ ] ✅ Test SMS received successfully
- [ ] ✅ Sheet updates correctly after send
- [ ] ✅ Menu appears and all functions work
- [ ] ✅ Logs show successful execution
- [ ] ✅ Error 21610 handled without crashing (if tested)
- [ ] ✅ Script Properties configured correctly
- [ ] ✅ All required columns present
- [ ] ✅ Twilio account has sufficient funds
- [ ] ✅ All recipients have actually opted in (COMPLIANCE!)

**If all checked:** 🎉 **System is ready for production use!**

---

## Support Resources

- 📄 [Quick Start Guide](QUICK_START.md) - 5-minute setup
- 📖 [Complete Setup Guide](BULK_SMS_SETUP.md) - Full documentation
- 🔧 [Technical Reference](ERROR_HANDLING_TECHNICAL.md) - Implementation details
- 📋 [Delivery Summary](DELIVERY_SUMMARY.md) - What was delivered

**Need help?** Check execution logs first:
- Apps Script editor → View → Logs
- Or: **📱 Bulk SMS → View Logs** from sheet menu

---

## Maintenance Checklist (Monthly)

- [ ] Review `last_error_code` column for patterns
- [ ] Check Twilio Console for usage and costs
- [ ] Verify opt-out numbers have `opt_in = NO`
- [ ] Clean up old test data
- [ ] Verify trigger is still active (if using)
- [ ] Check Apps Script quota usage (Executions page)

---

**Version:** 1.0  
**Last Updated:** February 2, 2026  
**Status:** Ready for Production
