## Project Image Assets Guide

This guide lists the screenshots and images to include in `docs/images/` for the README and future documentation. It also describes how to capture them, what to show, and what to redact. Filenames are important so links in the README resolve correctly.

### Capture settings
Use PNG format for clarity
Use a dark theme in Sheets for visual consistency if available
Aim for a width around 1400 to 1600 pixels to keep text readable on GitHub
Crop tight to the relevant UI area so the focus is clear

### Redaction rules
Do not show personal emails or phone numbers. Replace with placeholders such as `user@example.edu` and `+15555551234`
Do not show Twilio Account SID or Auth Token. Blur or crop the page
Do not show the passcode or the SHA256 hash value if you are in the Script Properties view

### Required images
Place these images in `docs/images/` with the exact filenames

1. `sidebar.png`
   The SMS composer sidebar in Ready state
   Show event selected template chosen and preview with linebreak markers
   Show recipients count and segment count chips

2. `confirm.png`
   The Confirm SMS Send modal
   Show event meta audience label recipients count characters and segments plus the final message

3. `sent.png`
   The sent screen after a successful send
   Show the phone bubble with the exact rendered message and the summary badges on the right

4. `menu.png`
   The custom SMS menu visible in Google Sheets after onOpen
   Expand the menu to show Open composer Send test to myself and Resend failures

5. `sheets-structure.png`
   The Google Sheet with the tabs visible Student Database Attendance Event Log and SMS Log
   Show one or two sample rows for each tab using placeholder data

6. `student-database-sheet.png`
   The Student Database sheet with headers
   Student Name Campus Email Phone # SMS Opt-In
   Include two to three sample rows with placeholder data

7. `attendance-sheet.png`
   The Attendance sheet with headers
   Event ID Campus Email
   Include two to three sample rows with placeholder data

8. `event-log-sheet.png`
   The Event Log sheet with headers at row three
   Event ID Date (MM/DD/20YY HH:MM AM/PM) Location Public Event Title
   Include one or two sample rows

9. `sms-log-sheet.png`
   The SMS Log sheet with a successful entry and a failed entry
   Show columns Timestamp To Body HTTP Code Status SID Error

10. `properties.png`
    The Apps Script Project Settings view showing Script properties
    Show SMS_ADMIN_EMAILS SMS_RATE_DELAY_MS and ADMIN_TEST_NUMBER configured with placeholder values

11. `passcode-gate.png`
    The sidebar when locked with the passcode prompt visible

### Optional images
These add depth for onboarding and operations

12. `twilio-console-number.png`
    The Twilio Console number configuration page showing SMS capability and messaging webhook field. Redact the phone number if needed

13. `webapp-deploy.png`
    The Apps Script Deploy as web app configuration. Useful if you plan to support inbound SMS via `smsInbound.js`

14. `clasp-push.png`
    A terminal view showing `clasp push` from the project root

### How to contribute images
Add your PNG files to `docs/images/`
Run `git add docs/images/*.png` then commit and push
Open a pull request with a short description of the images you added



