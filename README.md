# Jiu Jitsu Attendance

A lightweight attendance app for a Jiu Jitsu gym using:

- **GitHub Pages** for the web interface
- **Google Apps Script** for authentication and application logic
- **Google Sheets** as the owner-editable source of truth

## Architecture

```text
GitHub Pages
     |
     | HTTPS GET / POST
     v
Google Apps Script
     |
     v
Google Sheets
  - Students
  - Attendance
  - Classes
```

## Google Sheet schema

### Students

| student_id | name | belt | active |
|---|---|---|---|
| S001 | Example Student | White | TRUE |

### Attendance

| attendance_id | timestamp | date | student_id | student_name | class_id | class_name |
|---|---|---|---|---|---|---|

### Classes

| class_id | class_name | active |
|---|---|---|
| C001 | Adults | TRUE |

## Apps Script setup

The reference backend is in `google-apps-script/Code.gs`.

In the Google Sheet:

1. Open **Extensions → Apps Script**.
2. Paste the contents of `google-apps-script/Code.gs` into `Code.gs`.
3. Under **Project Settings → Script Properties**, add:
   - Property: `ADMIN_PIN_HASH`
   - Value: SHA-256 hash of the owner PIN.
4. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` web app URL.
6. Put that URL in `js/config.js`.

> The PIN itself must never be committed to GitHub.

## Current API URL

The frontend is configured to use the current deployed Apps Script web app in `js/config.js`.

## Local testing

Because the frontend calls an external Apps Script endpoint, use a simple local HTTP server instead of opening `index.html` with `file://`.

For example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

In the GitHub repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select:
   - Branch: `main`
   - Folder: `/ (root)`
4. Save.

The site should then be available at:

```text
https://luizkauffmann.github.io/Jiu_Jitsu_attendance/
```

## Security notes

- The repository may remain public.
- The Apps Script endpoint URL is not treated as a secret.
- The owner PIN is validated only in Apps Script.
- A successful login creates a short-lived session token.
- The browser stores the token only in `sessionStorage`.
- All attendance reads/writes require a valid session token.
