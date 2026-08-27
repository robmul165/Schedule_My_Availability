/**
 * "Is Rob Free?" — Google Apps Script backend
 * ---------------------------------------------
 * This script turns a Google Sheet into a tiny free "database + API" for the
 * static site. It does three things:
 *
 *   1. doGet()   — reads the "Availability" tab and returns it as JSON so
 *                  the website can render your schedule.
 *   2. doPost()  — receives a "request a time" submission from the website,
 *                  appends it as a new row on the "Requests" tab, and
 *                  emails you about it.
 *   3. onEdit()  — when you check the "Accepted" box on a Requests row,
 *                  automatically adds a matching Busy row to Availability
 *                  so that time is blocked on the site (unless it conflicts
 *                  with something already booked, in which case it unchecks
 *                  itself and leaves a heads-up instead). No setup needed —
 *                  Apps Script wires this up on its own.
 *
 * SETUP: See the project README for step-by-step instructions. In short —
 * paste this whole file into Extensions > Apps Script on your Google Sheet,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access:
 * Anyone), and paste the resulting URL into config.js as appsScriptUrl.
 */

// ----- Configuration ---------------------------------------------------

const SHEET_NAMES = {
  availability: 'Availability',
  requests: 'Requests',
};

const TIMEZONE = 'America/New_York';

// Where to send an email whenever someone submits a request. Leave blank
// ('') to turn notifications off.
const NOTIFY_EMAIL = 'robmul165@gmail.com';

// Column headers expected on each tab (row 1). Order doesn't matter as
// long as the header text matches exactly.
const AVAILABILITY_HEADERS = ['Type', 'Date', 'DayOfWeek', 'Start', 'End', 'Note'];
// "Accepted" and "Processed" support the auto-accept flow: check the
// "Accepted" box on a request row and onEdit() below automatically adds a
// matching Busy row to the Availability sheet. "Processed" is filled in
// automatically once that's happened, so re-editing the row (or Sheets
// re-firing onEdit) never adds the same Busy row twice — leave it alone.
const REQUESTS_HEADERS = ['Timestamp', 'Type', 'Name', 'Contact', 'Date', 'Start', 'End', 'Message', 'Accepted', 'Processed'];

const DAY_NAME_TO_NUMBER = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

// ----- Entry points ------------------------------------------------------

function doGet(e) {
  try {
    ensureSheetsExist_();
    const availability = readAvailability_();

    return jsonOutput_({
      ok: true,
      generatedAt: new Date().toISOString(),
      timezone: TIMEZONE,
      availability: availability,
    });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    ensureSheetsExist_();
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing request body.');
    }
    const payload = JSON.parse(e.postData.contents);

    // Honeypot: real visitors never fill this hidden field in. If it's
    // filled in, silently pretend success so bots move along.
    if (payload.honeypot) {
      return jsonOutput_({ ok: true });
    }

    if (payload.action !== 'request') {
      throw new Error('Unknown action: ' + payload.action);
    }

    const fields = {
      type: 'Request a time',
      name: payload.name,
      contact: payload.contact,
      date: payload.date,
      start: payload.start,
      end: payload.end,
      message: payload.message,
    };

    appendRequestRow_(fields);
    notifyOwner_(fields);

    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// Simple trigger: Apps Script recognizes this exact function name and fires
// it automatically on every edit to the spreadsheet — no manual trigger
// setup required. Runs as whoever is editing the sheet (you), with enough
// permission to read/write other tabs in this same spreadsheet.
function onEdit(e) {
  try {
    handleAcceptedEdit_(e);
  } catch (err) {
    console.error('onEdit failed: ' + (err && err.message ? err.message : err));
  }
}

function handleAcceptedEdit_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.requests) return;
  if (e.range.getRow() === 1) return; // header row

  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const acceptedCol = headerRow.indexOf('Accepted') + 1;
  const processedCol = headerRow.indexOf('Processed') + 1;
  if (!acceptedCol || e.range.getColumn() !== acceptedCol) return;

  const isAccepted = e.range.getValue() === true || String(e.range.getValue()).trim().toUpperCase() === 'TRUE';
  if (!isAccepted) return; // only act when checked ON — unchecking doesn't undo the Busy row

  const row = e.range.getRow();
  if (processedCol && String(sheet.getRange(row, processedCol).getValue()).trim() !== '') {
    return; // already handled this row — never add the Busy row twice
  }

  const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const get = function (name) {
    const idx = headerRow.indexOf(name);
    return idx === -1 ? '' : values[idx];
  };

  const type = get('Type');
  const date = get('Date');
  const start = get('Start');
  const end = get('End');
  const name = get('Name');

  if (type === 'Request a time' && date && start && end) {
    if (findBusyOverlap_(date, start, end)) {
      // Don't double-book: uncheck the box, leave a heads-up, and leave
      // "Processed" blank so you can accept it later once the conflict is
      // resolved (e.g. after declining/removing the other booking).
      e.range.setValue(false);
      try {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          'That time conflicts with something already booked on ' + date + ' — not added. ' +
          'Resolve the conflicting booking first, then check the box again.',
          '⚠️ Booking conflict',
          8
        );
      } catch (err) {
        console.error('toast failed: ' + (err && err.message ? err.message : err));
      }
      return;
    }
    getSheet_(SHEET_NAMES.availability).appendRow(['Busy', date, '', start, end, 'Accepted: ' + name]);
  }

  if (processedCol) {
    sheet.getRange(row, processedCol).setValue(new Date());
  }
}

// True if [start, end) on `date` (all "HH:MM" / "YYYY-MM-DD" strings)
// overlaps any existing "Busy" row already on the Availability sheet — the
// same recurring-by-weekday-or-one-off-by-date matching used elsewhere,
// checked directly against the sheet so it always reflects what's already
// accepted/blocked.
function findBusyOverlap_(date, startStr, endStr) {
  const reqStart = timeStringToMinutes_(startStr);
  const reqEnd = timeStringToMinutes_(endStr);
  if (reqStart === null || reqEnd === null || reqEnd <= reqStart) return false;

  const dow = dateStringToDow_(date);
  const rows = sheetToObjects_(getSheet_(SHEET_NAMES.availability), AVAILABILITY_HEADERS);

  return rows.some(function (r) {
    if (String(r.Type || '').trim().toLowerCase() !== 'busy') return false;

    const rowDate = formatDateCell_(r.Date);
    const dayName = String(r.DayOfWeek || '').trim().toLowerCase();
    const rowDow = dayName && DAY_NAME_TO_NUMBER.hasOwnProperty(dayName) ? DAY_NAME_TO_NUMBER[dayName] : null;

    const matchesThisDate = rowDate === date;
    const matchesRecurring = !rowDate && rowDow === dow;
    if (!matchesThisDate && !matchesRecurring) return false;

    const bStart = timeStringToMinutes_(formatTimeCell_(r.Start));
    const bEnd = timeStringToMinutes_(formatTimeCell_(r.End));
    if (bStart === null || bEnd === null || bEnd <= bStart) return false;

    return bStart < reqEnd && reqStart < bEnd; // interval overlap test
  });
}

function dateStringToDow_(iso) {
  const parts = String(iso).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
}

function timeStringToMinutes_(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ----- Reading ------------------------------------------------------------

function readAvailability_() {
  const rows = sheetToObjects_(getSheet_(SHEET_NAMES.availability), AVAILABILITY_HEADERS);
  return rows
    .filter(function (r) { return r.Type; })
    .map(function (r) {
      const dayName = String(r.DayOfWeek || '').trim().toLowerCase();
      return {
        type: String(r.Type).trim().toLowerCase(), // "free" | "busy"
        date: formatDateCell_(r.Date), // "YYYY-MM-DD" or ""
        dayOfWeek: dayName && DAY_NAME_TO_NUMBER.hasOwnProperty(dayName) ? DAY_NAME_TO_NUMBER[dayName] : null,
        start: formatTimeCell_(r.Start),
        end: formatTimeCell_(r.End),
        note: r.Note ? String(r.Note).trim() : '',
      };
    })
    .filter(function (r) { return r.start && r.end && (r.date || r.dayOfWeek !== null); });
}

// ----- Writing --------------------------------------------------------

function appendRequestRow_(fields) {
  const sheet = getSheet_(SHEET_NAMES.requests);
  const timestamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  appendRowByHeader_(sheet, {
    Timestamp: timestamp,
    Type: fields.type || '',
    Name: fields.name || '',
    Contact: fields.contact || '',
    Date: fields.date || '',
    Start: fields.start || '',
    End: fields.end || '',
    Message: fields.message || '',
    // "Accepted" / "Processed" intentionally left blank — you check the box.
  });
}

// Appends a new row, placing each value under the column whose header text
// matches its key — instead of assuming a fixed column order. This matters
// because a sheet that's been through header changes (e.g. old EventId/
// EventTitle columns from before Events was removed) can have columns in a
// different order/position than REQUESTS_HEADERS describes; writing by
// position in that case silently puts values under the wrong header. Any
// key with no matching header is just skipped (nothing to write there).
function appendRowByHeader_(sheet, values) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const row = new Array(lastCol).fill('');
  Object.keys(values).forEach(function (key) {
    const idx = headerRow.indexOf(key);
    if (idx !== -1) row[idx] = values[key];
  });
  sheet.appendRow(row);
}

// Emails NOTIFY_EMAIL about a new request. Failures here (e.g. mail quota)
// are logged but never break the response the site sees — the row is
// already saved on the sheet either way.
function notifyOwner_(fields) {
  if (!NOTIFY_EMAIL) return;
  try {
    const subject = fields.name + ' requested a time — ' + fields.date + ' ' + fields.start + '-' + fields.end;
    let body =
      'Name: ' + fields.name + '\n' +
      'Contact: ' + fields.contact + '\n' +
      'Date: ' + fields.date + '\n' +
      'Time: ' + fields.start + '–' + fields.end + '\n' +
      (fields.message ? '\nMessage: ' + fields.message + '\n' : '');
    body += '\n(Check the box in the Accepted column on the Requests tab to accept and block that time.)';
    MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
  } catch (err) {
    console.error('notifyOwner_ failed: ' + (err && err.message ? err.message : err));
  }
}

// ----- Sheet helpers ----------------------------------------------------

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Missing tab "' + name + '". Check the README for the exact tab names needed.');
  }
  return sheet;
}

// Creates any missing tabs with the correct header row so a fresh copy of
// this script "just works" the first time it's run. Never overwrites data
// on an existing tab — but does add any newly-introduced header columns
// (like "Accepted"/"Processed") to an existing Requests tab automatically.
function ensureSheetsExist_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  createIfMissing_(ss, SHEET_NAMES.availability, AVAILABILITY_HEADERS);
  createIfMissing_(ss, SHEET_NAMES.requests, REQUESTS_HEADERS);
  ensureHeaderColumns_(getSheet_(SHEET_NAMES.requests), REQUESTS_HEADERS);
}

function createIfMissing_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
}

// Adds any header columns from `headers` that don't already exist on
// `sheet`, appending them to the right of the existing header row. Lets us
// evolve the Requests sheet's columns (e.g. adding "Accepted") without
// requiring existing users to manually edit their sheet. "Accepted" also
// gets real checkboxes for a few hundred rows so it's clickable right away.
function ensureHeaderColumns_(sheet, headers) {
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];

  headers.forEach(function (header) {
    if (existing.indexOf(header) !== -1) return;
    const colIndex = sheet.getLastColumn() + 1;
    sheet.getRange(1, colIndex).setValue(header);
    existing.push(header);
    if (header === 'Accepted') {
      try {
        sheet.getRange(2, colIndex, 500, 1).insertCheckboxes();
      } catch (err) {
        console.error('insertCheckboxes failed: ' + (err && err.message ? err.message : err));
      }
    }
  });
}

function sheetToObjects_(sheet, expectedHeaders) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headerRow = values[0].map(function (h) { return String(h).trim(); });
  const rows = values.slice(1);

  return rows
    .filter(function (row) { return row.some(function (cell) { return cell !== '' && cell !== null; }); })
    .map(function (row) {
      const obj = {};
      expectedHeaders.forEach(function (header) {
        const colIndex = headerRow.indexOf(header);
        obj[header] = colIndex === -1 ? '' : row[colIndex];
      });
      return obj;
    });
}

function formatDateCell_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function formatTimeCell_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TIMEZONE, 'HH:mm');
  }
  // Accept "6:30 PM" style text too, normalize to 24h "HH:mm".
  const str = String(value).trim();
  const ampmMatch = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2];
    const isPM = /pm/i.test(ampmMatch[3]);
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return (hour < 10 ? '0' : '') + hour + ':' + minute;
  }
  return str;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
