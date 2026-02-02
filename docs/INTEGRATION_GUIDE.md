# Integration Guide: Bulk SMS with Your Existing System

## What Was Changed

Your `smsBulkSend.js` has been configured to work with your **existing "Student Database" sheet** and your existing Twilio setup.

---

## ✅ What Now Works

### Uses Your Existing Sheet
- **Sheet Name**: `Student Database` (your existing sheet)
- **Existing Columns Used**:
  - `Phone #` → Used for sending
  - `SMS Opt-In` → Checked before sending (must be "yes" or "YES")

### Auto-Adds Tracking Columns
The script will automatically add these columns to your "Student Database" sheet on first run:
- `Last Sent At` - Timestamp of last send
- `Last Error Code` - Twilio error code (e.g., 21610)
- `Last Error` - Error message
- `Send Status` - SENT, FAILED, or OPTED_OUT

**Note:** These columns are added to the END of your sheet, so they won't affect your existing data or other scripts.

### Uses Your Existing Twilio Setup
- ✅ `TWILIO_ACCOUNT_SID` (already configured)
- ✅ `TWILIO_AUTH_TOKEN` (already configured)
- ✅ `TWILIO_FROM_NUMBER` (your existing property)
- ✅ `TWILIO_MESSAGING_SERVICE_SID` (if you have one)

### Integrates with Your Menu System
- Your existing **SMS** menu still works (sidebar composer, events, etc.)
- New **📱 Bulk SMS** menu added for batch sending

---

## 🚀 How to Use

### Step 1: Add the Script
1. In your Google Sheet: **Extensions → Apps Script**
2. Create new file: **File → New → Script file**
3. Name it: `smsBulkSend`
4. Paste the entire updated `smsBulkSend.js` code
5. **Save** (Ctrl+S / Cmd+S)

### Step 2: Update Your Main onOpen (ALREADY DONE)
I've already updated `smsSend.js` to call the bulk SMS menu. You should see this line:

```javascript
function onOpen() {
  try { if (typeof onOpenStudentSync_ === 'function') onOpenStudentSync_(); } catch(e) {}
  try { onOpenSms_(); } catch(e) {}
  try { if (typeof onOpenBulkSms_ === 'function') onOpenBulkSms_(); } catch(e) {} // NEW
}
```

### Step 3: Refresh Your Sheet
1. Go back to your Google Sheet
2. Press **F5** to refresh
3. Wait 5 seconds for menus to load

### Step 4: Send Bulk SMS
1. Look for the new **📱 Bulk SMS** menu in the menu bar
2. Click **📱 Bulk SMS → Send Bulk SMS**
3. The script will:
   - ✅ Read from your "Student Database" sheet
   - ✅ Send to everyone with `SMS Opt-In` = "yes" or "YES"
   - ✅ Skip anyone with blank phone numbers
   - ✅ Add tracking columns on first run (if they don't exist)
   - ✅ Update each row with send status

---

## 🛡️ Error 21610 Handling

### What Happens When Someone Opts Out:

**Before send:**
| Phone # | SMS Opt-In | Send Status | Last Error Code |
|---------|------------|-------------|-----------------|
| +15551234567 | yes | | |
| +15559876543 | yes | | |

**After send (middle number opted out):**
| Phone # | SMS Opt-In | Send Status | Last Error Code | Last Error |
|---------|------------|-------------|-----------------|------------|
| +15551234567 | yes | SENT | | |
| +15559876543 | **NO** | **OPTED_OUT** | **21610** | **The recipient has opted out** |

Key points:
1. ✅ `SMS Opt-In` is changed from "yes" to **"NO"**
2. ✅ Error 21610 is logged
3. ✅ Script continues sending to remaining contacts
4. ✅ **NO CRASH** - execution completes successfully
5. ✅ Next time you run it, opted-out numbers are automatically skipped

---

## 📋 What Each Column Does

### Existing Columns (Not Modified)
- **Student Name** - Unchanged by bulk SMS script
- **Campus Email** - Unchanged by bulk SMS script
- **Phone #** - Used for sending, never modified
- **SMS Opt-In** - Checked before sending, changed to "NO" on error 21610

### New Tracking Columns (Auto-Added)
- **Message** - Optional custom message per student (leave empty for default)
- **Last Sent At** - Timestamp when SMS was attempted
- **Last Error Code** - Twilio error code (21610, 21211, etc.) or empty on success
- **Last Error** - Human-readable error message or empty on success
- **Send Status** - SENT, FAILED, or OPTED_OUT

---

## 🎯 How It Works with Your Existing System

### Your Event-Based System (Unchanged)
- **Sheet**: Student Database, Attendance, Event Log
- **Use Case**: Send targeted messages to event attendees
- **Features**: Event selection, templates, sidebar UI
- **Menu**: **SMS → Open composer**

### New Bulk SMS System (New)
- **Sheet**: Same Student Database (shared!)
- **Use Case**: Send bulk announcements to all opted-in students
- **Features**: Batch processing, error handling, auto-resume
- **Menu**: **📱 Bulk SMS → Send Bulk SMS**

**Both systems:**
- ✅ Share the same contacts in "Student Database"
- ✅ Respect the same `SMS Opt-In` column
- ✅ Use the same Twilio credentials
- ✅ Work independently without conflicts

---

## 🧪 Test It First

### Quick Test (1 minute)
1. Find a test row in "Student Database" with:
   - Your phone number in `Phone #`
   - `SMS Opt-In` = yes
2. Click **📱 Bulk SMS → Send Bulk SMS**
3. Check your phone for SMS
4. Check that row - should show:
   - `Send Status` = SENT
   - `Last Sent At` has timestamp
   - `Last Error Code` is empty

### Test Error 21610 (Optional, 5 minutes)
1. Add a test row with a number you've sent STOP to
2. Set `SMS Opt-In` = yes
3. Run **📱 Bulk SMS → Send Bulk SMS**
4. Check that row - should show:
   - `SMS Opt-In` changed to **NO**
   - `Send Status` = OPTED_OUT
   - `Last Error Code` = 21610
5. Verify: No error popup, script completed successfully

---

## ⚙️ Configuration

### Batch Size (Default: 50 rows per run)
If you have more than 50 students, the script will process in batches:
- **Run 1**: Rows 1-50
- **Run 2**: Rows 51-100
- **Run 3**: Rows 101-150
- etc.

To change batch size, edit `smsBulkSend.js`:
```javascript
const CONFIG = {
  BATCH_SIZE: 50, // Change to 100, 200, etc.
  ...
};
```

### Rate Limiting (Default: 200ms delay between sends)
To prevent Twilio rate limiting:
```javascript
const CONFIG = {
  RATE_LIMIT_MS: 200, // Change to 500 for slower, safer sending
  ...
};
```

### Auto-Resume for Large Lists
If you have 100+ students, set up a time-based trigger:
1. Apps Script editor → **⏰ Triggers**
2. **+ Add Trigger**
3. Function: `sendBulkSMS`
4. Event source: **Time-driven**
5. Interval: **Every 5 minutes**

The script will automatically resume where it left off.

---

## 🔍 View Logs

Check what happened during the last run:
1. **📱 Bulk SMS → View Logs**
2. Or in Apps Script editor: **View → Logs**

Logs show:
- How many sent successfully
- How many failed
- How many opted out (error 21610)
- Per-row details

---

## ❓ FAQ

### Q: Will this break my existing SMS system?
**A:** No! The bulk SMS script:
- Uses the same sheet but adds new columns at the end
- Doesn't modify your existing scripts
- Has its own separate menu
- Uses the same Twilio credentials

### Q: What if tracking columns already exist?
**A:** The script detects existing columns by name and uses them. It only adds columns that are missing.

### Q: What if someone opted out before I added this script?
**A:** Just set their `SMS Opt-In` to "NO" manually. The script will skip them.

### Q: Can I still use the sidebar composer?
**A:** Yes! Your existing event-based SMS system still works exactly as before.

### Q: What happens if I run bulk SMS on a student who already got a message from the sidebar?
**A:** Nothing bad. The script will send another message. The tracking columns show the LAST send attempt, so they'll be updated.

### Q: Can I add a custom message per student?
**A:** Yes! Add values to the "Message" column. If empty, the default message is used.

---

## 🆘 Troubleshooting

### Menu doesn't appear
- Refresh the sheet (F5) and wait 10 seconds
- Check Apps Script editor for save errors
- Make sure `smsBulkSend.js` is saved

### "Missing required columns" error
- Check that "Student Database" sheet exists
- Check that `Phone #` and `SMS Opt-In` columns exist in row 1

### No messages sending
- Check `SMS Opt-In` values are "yes" or "YES" (not "y" or "1")
- Check phone numbers are in correct format (+15551234567)
- Check Twilio Console for account balance

### Script times out
- Reduce `BATCH_SIZE` to 25-30
- Set up time-based trigger (see Configuration above)

---

## ✅ Summary

You now have:
- ✅ Bulk SMS that works with your existing "Student Database" sheet
- ✅ Automatic error 21610 handling (sets `SMS Opt-In` to NO)
- ✅ No crashes - script continues on any error
- ✅ Tracking columns auto-added for monitoring
- ✅ Works alongside your existing event-based SMS system
- ✅ Uses your existing Twilio credentials

**Next step:** Refresh your sheet and look for the **📱 Bulk SMS** menu!

---

## 📚 Additional Resources

- 📄 [Quick Start](QUICK_START.md) - General bulk SMS guide
- 📖 [Complete Setup](BULK_SMS_SETUP.md) - Full documentation
- 🔧 [Technical Details](ERROR_HANDLING_TECHNICAL.md) - How error handling works
- ☑️ [Setup Checklist](SETUP_CHECKLIST.md) - Step-by-step verification

**Need help?** Check the logs first: **📱 Bulk SMS → View Logs**
