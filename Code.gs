/**
 * "Is Rob Free?" — Google Apps Script backend
 * ---------------------------------------------
 * This script turns a Google Sheet into a tiny free "database + API" for the
 * static site. It does two things:
 *
 *   1. doGet()  — reads the "Availability" and "Events" tabs and returns
 *                 them as JSON so the website can render them.
 *   2. doPost() — receives a "request a time" or "join an event" submission
 *                 from the website and appends it as a new row on the
 *                 "Requests" tab.
 *
 * SETUP: See the project README for step-by-step instructions. In short —
 * paste this whole file into Extensions > Apps Script on your Google Sheet,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access:
 * Anyone), and paste the resulting URL into js/config.js as appsScriptUrl.
 *
 * You do not need to edit anything below unless you want to change the
 * sheet/tab names or add new fields.
 */

// ----- Configuration ---------------------------------------------------

const SHEET_NAMES = {
  availability: 'Availability',
  events: 'Events',
  requests: 'Requests',
};

const TIMEZONE = 'America/New_York';

// Column headers expected on each tab (row 1). Order doesn't matter as
// long as the header text matches exactly.
const AVAILABILITY_HEADERS = ['Type', 'Date', 'DayOfWeek', 'Start', 'End', 'Note'];
const EVENTS_HEADERS = ['ID', 'Date', 'Start', 'End', 'Title', 'Location', 'Description', 'Link', 'Capacity'];
const REQUESTS_HEADERS = ['Timestamp', 'Type', 'Name', 'Contact', 'Date', 'Start', 'End', 'EventId', 'EventTitle', 'Message'];

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
    const events = readEvents_();
    const joinCounts = countJoinsByEvent_();

    events.forEach(function (ev) {
      ev.joined = joinCounts[ev.id] || 0;
    });

    return jsonOutput_({
      ok: true,
      generatedAt: new Date().toISOString(),
      timezone: TIMEZONE,
      availability: availability,
      events: events,
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

    const action = payload.action;
    if (action === 'request') {
      appendRequestRow_({
        type: 'Request a time',
        name: payload.name,
        contact: payload.contact,
        date: payload.date,
        start: payload.start,
        end: payload.end,
        eventId: '',
        eventTitle: '',
        message: payload.message,
      });
    } else if (action === 'join') {
      appendRequestRow_({
        type: 'Join event',
        name: payload.name,
        contact: payload.contact,
        date: '',
        start: '',
        end: '',
        eventId: payload.eventId,
        eventTitle: payload.eventTitle,
        message: payload.message,
      });
    } else {
      throw new Error('Unknown action: ' + action);
    }

    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
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

function readEvents_() {
  const rows = sheetToObjects_(getSheet_(SHEET_NAMES.events), EVENTS_HEADERS);
  return rows
    .filter(function (r) { return r.Title && r.Date; })
    .map(function (r, idx) {
      return {
        id: r.ID ? String(r.ID).trim() : 'evt-' + (idx + 1),
        date: formatDateCell_(r.Date),
        start: formatTimeCell_(r.Start),
        end: formatTimeCell_(r.End),
        title: String(r.Title).trim(),
        location: r.Location ? String(r.Location).trim() : '',
        description: r.Description ? String(r.Description).trim() : '',
        link: r.Link ? String(r.Link).trim() : '',
        capacity: r.Capacity !== '' && r.Capacity !== null && !isNaN(r.Capacity) ? Number(r.Capacity) : null,
      };
    });
}

function countJoinsByEvent_() {
  const rows = sheetToObjects_(getSheet_(SHEET_NAMES.requests), REQUESTS_HEADERS);
  const counts = {};
  rows.forEach(function (r) {
    if (r.Type === 'Join event' && r.EventId) {
      counts[r.EventId] = (counts[r.EventId] || 0) + 1;
    }
  });
  return counts;
}

// ----- Writing --------------------------------------------------------

function appendRequestRow_(fields) {
  const sheet = getSheet_(SHEET_NAMES.requests);
  const timestamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    timestamp,
    fields.type || '',
    fields.name || '',
    fields.contact || '',
    fields.date || '',
    fields.start || '',
    fields.end || '',
    fields.eventId || '',
    fields.eventTitle || '',
    fields.message || '',
  ]);
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
// on an existing tab.
function ensureSheetsExist_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  createIfMissing_(ss, SHEET_NAMES.availability, AVAILABILITY_HEADERS);
  createIfMissing_(ss, SHEET_NAMES.events, EVENTS_HEADERS);
  createIfMissing_(ss, SHEET_NAMES.requests, REQUESTS_HEADERS);
}

function createIfMissing_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
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
