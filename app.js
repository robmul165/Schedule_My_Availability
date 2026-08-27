/**
 * "Is Rob Free?" — front-end logic.
 * Fetches availability/events from the Apps Script backend, renders them,
 * and submits "request a time" / "join event" forms back to it.
 * No build step, no dependencies — plain browser JS.
 */

(function () {
  'use strict';

  const state = {
    availability: [],
    events: [],
  };

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------- Boot ----------

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    document.getElementById('site-title').textContent = CONFIG.siteName;
    document.getElementById('site-tagline').textContent = CONFIG.tagline;
    document.getElementById('tz-label').textContent = CONFIG.timezoneLabel;
    document.title = CONFIG.siteName;

    setupTabs();
    setupModal();

    if (!CONFIG.appsScriptUrl || CONFIG.appsScriptUrl.indexOf('PASTE_YOUR') === 0) {
      document.getElementById('setup-banner').classList.remove('hidden');
      renderEmpty('availability-list', 'Schedule not connected yet.');
      renderEmpty('events-list', 'Events not connected yet.');
      return;
    }

    loadData();
  }

  function loadData() {
    fetchJSON(CONFIG.appsScriptUrl + '?action=data', { method: 'GET' })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || 'Unknown error loading data.');
        state.availability = data.availability || [];
        state.events = data.events || [];
        renderAvailability();
        renderEvents();
      })
      .catch(function (err) {
        renderEmpty('availability-list', "Couldn't load the schedule (" + err.message + ").");
        renderEmpty('events-list', "Couldn't load events (" + err.message + ").");
      });
  }

  // ---------- Tabs ----------

  function setupTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ---------- Availability rendering ----------

  function renderAvailability() {
    const container = document.getElementById('availability-list');
    const days = buildDailyAvailability(state.availability, CONFIG.daysAhead || 14);

    if (!days.length) {
      renderEmpty('availability-list', 'No availability configured yet.');
      return;
    }

    container.innerHTML = '';
    days.forEach(function (day) {
      const card = document.createElement('div');
      const isFree = day.windows.length > 0;
      card.className = 'day-card' + (isFree ? ' is-free' : '');

      const info = document.createElement('div');
      info.className = 'day-info';
      const name = document.createElement('div');
      name.className = 'day-name';
      name.textContent = day.label;
      const dateEl = document.createElement('div');
      dateEl.className = 'day-date';
      dateEl.textContent = day.dateLabel;
      info.appendChild(name);
      info.appendChild(dateEl);

      const windowsEl = document.createElement('div');
      windowsEl.className = 'day-windows';
      if (isFree) {
        day.windows.forEach(function (w) {
          const span = document.createElement('span');
          span.className = 'free-slot';
          span.textContent = minutesToLabel(w.start) + '–' + minutesToLabel(w.end);
          windowsEl.appendChild(span);
        });
      } else {
        const span = document.createElement('span');
        span.className = 'busy-label';
        span.textContent = 'Busy';
        windowsEl.appendChild(span);
      }

      card.appendChild(info);
      card.appendChild(windowsEl);

      // Every day is clickable, even ones shown as fully busy — the request
      // form itself doesn't restrict what time someone asks for.
      card.addEventListener('click', function () { openRequestModal(day); });

      container.appendChild(card);
    });
  }

  // Builds free windows per day for the next `daysAhead` days.
  //
  // The baseline for every day is CONFIG.defaultDayStart–defaultDayEnd (the
  // whole day is open unless you say otherwise) — you only need the
  // Availability sheet at all to carve out "Busy" chunks, recurring by
  // weekday or one-off on a specific date. A recurring "Free" row for a
  // weekday still works and overrides the default bounds for that weekday,
  // for backward compatibility / days with different default hours.
  //
  // Precedence rule, applied consistently to both "Free" and "Busy" rows:
  // a row with `Date` filled in is ALWAYS treated as one-off for that exact
  // date only — `DayOfWeek` is ignored whenever `Date` is present. This
  // matters if you ever copy a recurring row as a template for a one-off
  // entry and forget to clear DayOfWeek: it still only affects that one date,
  // never "every Wednesday" (etc).
  function buildDailyAvailability(rows, daysAhead) {
    const today = startOfToday();
    const result = [];
    const defaultStart = toMinutes(CONFIG.defaultDayStart || '00:00');
    const defaultEnd = toMinutes(CONFIG.defaultDayEnd || '24:00');

    for (let i = 0; i < daysAhead; i++) {
      const d = addDays(today, i);
      const iso = toISODate(d);
      const dow = d.getDay();

      // Recurring "free" rows for this weekday (Date blank) override the
      // default day bounds, if any are defined for this weekday.
      const recurringFree = rows
        .filter(function (r) { return r.type === 'free' && !r.date && r.dayOfWeek === dow; })
        .map(function (r) { return { start: toMinutes(r.start), end: toMinutes(r.end) }; })
        .filter(function (w) { return w.start !== null && w.end !== null && w.end > w.start; });

      let windows = recurringFree.length
        ? recurringFree
        : (defaultStart !== null && defaultEnd !== null && defaultEnd > defaultStart
          ? [{ start: defaultStart, end: defaultEnd }]
          : []);

      // Recurring "busy" rows for this weekday (Date blank) — e.g. "every
      // Wednesday 9–5 I'm at work".
      rows
        .filter(function (r) { return r.type === 'busy' && !r.date && r.dayOfWeek === dow; })
        .forEach(function (r) {
          windows = subtractInterval(windows, toMinutes(r.start), toMinutes(r.end));
        });

      // One-off "busy" override for this exact date.
      rows
        .filter(function (r) { return r.type === 'busy' && r.date === iso; })
        .forEach(function (r) {
          windows = subtractInterval(windows, toMinutes(r.start), toMinutes(r.end));
        });

      // One-off "free" addition for this exact date (e.g. extra hours before a trip).
      rows
        .filter(function (r) { return r.type === 'free' && r.date === iso; })
        .forEach(function (r) {
          const s = toMinutes(r.start), e = toMinutes(r.end);
          if (s !== null && e !== null && e > s) windows.push({ start: s, end: e });
        });

      windows = mergeIntervals(windows);

      result.push({
        date: iso,
        dow: dow,
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[dow],
        dateLabel: formatFriendlyDate(d),
        windows: windows,
      });
    }
    return result;
  }

  // ---------- Events rendering ----------

  function renderEvents() {
    const container = document.getElementById('events-list');
    const upcoming = (state.events || [])
      .filter(function (ev) { return ev.date && toMinutes(ev.start) !== null; })
      .filter(function (ev) { return eventDateTime(ev) >= new Date(); })
      .sort(function (a, b) { return eventDateTime(a) - eventDateTime(b); });

    if (!upcoming.length) {
      renderEmpty('events-list', "Nothing on the calendar right now — schedule quick!");
      return;
    }

    container.innerHTML = '';
    upcoming.forEach(function (ev) {
      const card = document.createElement('div');
      card.className = 'event-card';

      const top = document.createElement('div');
      top.className = 'event-top';
      const title = document.createElement('h3');
      title.className = 'event-title';
      title.textContent = ev.title;
      const when = document.createElement('div');
      when.className = 'event-when';
      when.textContent = formatFriendlyDate(parseISODate(ev.date)) + ' · ' + minutesToLabel(toMinutes(ev.start));
      top.appendChild(title);
      top.appendChild(when);
      card.appendChild(top);

      if (ev.location) {
        const meta = document.createElement('div');
        meta.className = 'event-meta';
        meta.textContent = '📍 ' + ev.location;
        card.appendChild(meta);
      }

      if (ev.description) {
        const desc = document.createElement('div');
        desc.className = 'event-desc';
        desc.textContent = ev.description;
        card.appendChild(desc);
      }

      const actions = document.createElement('div');
      actions.className = 'event-actions';

      const joinedEl = document.createElement('div');
      joinedEl.className = 'event-joined';
      const full = ev.capacity !== null && ev.joined >= ev.capacity;
      joinedEl.textContent = ev.capacity !== null
        ? ev.joined + ' / ' + ev.capacity + ' joined'
        : (ev.joined > 0 ? ev.joined + ' joined so far' : '');
      actions.appendChild(joinedEl);

      const joinBtn = document.createElement('button');
      joinBtn.className = 'btn';
      joinBtn.textContent = full ? "Full" : "I'm in!";
      joinBtn.disabled = full;
      if (!full) joinBtn.addEventListener('click', function () { openJoinModal(ev); });
      actions.appendChild(joinBtn);

      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  function renderEmpty(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = message;
    container.appendChild(p);
  }

  // ---------- Modals ----------

  function setupModal() {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'modal-overlay') closeModal();
    });
  }

  function openModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function openRequestModal(day) {
    const durationOptions = CONFIG.slotDurationOptions || [30, 60, 90, 120];
    const defaultDuration = CONFIG.defaultSlotDuration || 60;
    const stepMinutes = CONFIG.slotStepMinutes || 30;

    const durationOptionsHTML = durationOptions.map(function (mins) {
      return '<option value="' + mins + '"' + (mins === defaultDuration ? ' selected' : '') + '>' +
        formatDuration(mins) + '</option>';
    }).join('');

    const windowsRangeText = day.windows.map(function (w) {
      return minutesToLabel(w.start) + '–' + minutesToLabel(w.end);
    }).join(', ');

    openModal(
      '<h2>Request a time</h2>' +
      '<p class="modal-sub">' + day.label + ', ' + day.dateLabel + '</p>' +
      '<form id="request-form">' +
        '<div class="field"><label>Your name</label><input type="text" name="name" required></div>' +
        '<div class="field"><label>Best way to reach you (phone or email)</label><input type="text" name="contact" required></div>' +
        '<div class="field">' +
          '<label>How would you like to pick a time?</label>' +
          '<div class="time-mode-toggle">' +
            '<button type="button" class="mode-btn active" data-mode="slot">Pick a time block</button>' +
            '<button type="button" class="mode-btn" data-mode="custom">Choose exact time</button>' +
          '</div>' +
        '</div>' +
        '<div class="time-mode-panel" data-mode-panel="slot">' +
          '<div class="field-row">' +
            '<div class="field"><label>Length</label>' +
              '<select name="duration">' + durationOptionsHTML + '</select>' +
            '</div>' +
            '<div class="field"><label>Time Slot</label>' +
              '<select name="slotStart">' + buildSlotOptionsHTML(day.windows, defaultDuration, stepMinutes) + '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="time-mode-panel hidden" data-mode-panel="custom">' +
          '<div class="field-row">' +
            '<div class="field"><label>Start</label><input type="time" name="customStart"></div>' +
            '<div class="field"><label>End</label><input type="time" name="customEnd"></div>' +
          '</div>' +
          '<p class="field-hint">' +
            (windowsRangeText ? 'Usually free: ' + windowsRangeText + ' — but ask for any time, any day.' : 'Nothing usually free this day, but ask for any time anyway.') +
          '</p>' +
        '</div>' +
        '<div class="field"><label>What do you want to do?</label><textarea name="message" placeholder="Coffee? Deep philisophical conversations? Schedule now!"></textarea></div>' +
        '<input class="hp-field" tabindex="-1" autocomplete="off" type="text" name="honeypot">' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-secondary" id="request-cancel">Cancel</button>' +
          '<button type="submit" class="btn">Send request</button>' +
        '</div>' +
      '</form>'
    );

    const form = document.getElementById('request-form');
    const modeButtons = form.querySelectorAll('.mode-btn');
    const modePanels = form.querySelectorAll('.time-mode-panel');
    const durationSelect = form.querySelector('select[name="duration"]');
    const slotStartSelect = form.querySelector('select[name="slotStart"]');

    modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        modeButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        modePanels.forEach(function (panel) {
          panel.classList.toggle('hidden', panel.dataset.modePanel !== mode);
        });
      });
    });

    durationSelect.addEventListener('change', function () {
      slotStartSelect.innerHTML = buildSlotOptionsHTML(day.windows, Number(durationSelect.value), stepMinutes);
    });

    document.getElementById('request-cancel').addEventListener('click', closeModal);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const mode = form.querySelector('.mode-btn.active').dataset.mode;

      let start, end;
      if (mode === 'custom') {
        start = toMinutes(form.customStart.value);
        end = toMinutes(form.customEnd.value);
        if (start === null || end === null) {
          showToast('Pick a start and end time.', true);
          return;
        }
        if (end <= start) {
          showToast('End time has to be after the start time.', true);
          return;
        }
        // Intentionally not restricted to day.windows — someone can request
        // any time, including outside the windows shown; it's still just a
        // request, so it's fine to let them ask and you decide.
      } else {
        if (!slotStartSelect.value) {
          showToast('No start times available for that length — try a shorter block or an exact time.', true);
          return;
        }
        const [s, e2] = slotStartSelect.value.split('-');
        start = Number(s);
        end = Number(e2);
      }

      submitPayload({
        action: 'request',
        name: form.name.value.trim(),
        contact: form.contact.value.trim(),
        date: day.date,
        start: minutesToHHMM(start),
        end: minutesToHHMM(end),
        message: form.message.value.trim(),
        honeypot: form.honeypot.value,
      }, form.querySelector('button[type="submit"]'), 'Request sent! ' + CONFIG.ownerFirstName + ' will get back to you.');
    });
  }

  // Build <option> elements for every valid start time of `durationMinutes`
  // within `windows`, stepping every `stepMinutes`. Always includes the
  // latest possible start in each window even if the step doesn't land on it,
  // so the full window remains reachable.
  function buildSlotOptionsHTML(windows, durationMinutes, stepMinutes) {
    const slots = [];
    windows.forEach(function (w) {
      const lastStart = w.end - durationMinutes;
      if (lastStart < w.start) return; // window too short for this duration
      for (let s = w.start; s <= lastStart; s += stepMinutes) {
        slots.push({ start: s, end: s + durationMinutes });
      }
      // Make sure the latest possible start is reachable even when the step
      // size doesn't divide evenly into the window.
      if (slots[slots.length - 1].start !== lastStart) {
        slots.push({ start: lastStart, end: w.end });
      }
    });

    if (!slots.length) {
      return '<option value="" disabled selected>No times of that length available</option>';
    }

    return slots.map(function (s) {
      return '<option value="' + s.start + '-' + s.end + '">' +
        minutesToLabel(s.start) + '–' + minutesToLabel(s.end) + '</option>';
    }).join('');
  }

  function formatDuration(mins) {
    if (mins < 60) return mins + ' min';
    const hours = mins / 60;
    const hourLabel = (hours % 1 === 0) ? String(hours) : hours.toFixed(1);
    return hourLabel + (hours === 1 ? ' hr' : ' hrs');
  }

  function openJoinModal(ev) {
    openModal(
      '<h2>' + escapeHTML(ev.title) + '</h2>' +
      '<p class="modal-sub">' + formatFriendlyDate(parseISODate(ev.date)) + ' · ' + minutesToLabel(toMinutes(ev.start)) + '</p>' +
      '<form id="join-form">' +
        '<div class="field"><label>Your name</label><input type="text" name="name" required></div>' +
        '<div class="field"><label>Best way to reach you (phone, email, or handle)</label><input type="text" name="contact" required></div>' +
        '<div class="field"><label>Anything to add? (optional)</label><textarea name="message" placeholder="Can\'t wait!"></textarea></div>' +
        '<input class="hp-field" tabindex="-1" autocomplete="off" type="text" name="honeypot">' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-secondary" id="join-cancel">Cancel</button>' +
          '<button type="submit" class="btn">I\'m in!</button>' +
        '</div>' +
      '</form>'
    );

    document.getElementById('join-cancel').addEventListener('click', closeModal);
    document.getElementById('join-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const form = e.target;
      submitPayload({
        action: 'join',
        name: form.name.value.trim(),
        contact: form.contact.value.trim(),
        eventId: ev.id,
        eventTitle: ev.title,
        message: form.message.value.trim(),
        honeypot: form.honeypot.value,
      }, form.querySelector('button[type="submit"]'), "You're in! " + CONFIG.ownerFirstName + " will see you there.");
    });
  }

  function submitPayload(payload, submitBtn, successMessage) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    fetchJSON(CONFIG.appsScriptUrl, {
      method: 'POST',
      // text/plain avoids a CORS preflight against the Apps Script web app.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || 'Something went wrong.');
        closeModal();
        showToast(successMessage, false);
        loadData(); // refresh join counts, etc.
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try again';
        showToast("Couldn't send that (" + err.message + ")", true);
      });
  }

  // ---------- Toast ----------

  let toastTimer = null;
  function showToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', !!isError);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 4000);
  }

  // ---------- Networking ----------

  function fetchJSON(url, options) {
    return fetch(url, options).then(function (res) {
      if (!res.ok) throw new Error('Server returned ' + res.status);
      return res.json();
    });
  }

  // ---------- Date/time helpers ----------

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseISODate(iso) {
    const parts = String(iso).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatFriendlyDate(d) {
    return DAY_NAMES_SHORT[d.getDay()] + ', ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function eventDateTime(ev) {
    const d = parseISODate(ev.date);
    const mins = toMinutes(ev.start) || 0;
    d.setMinutes(d.getMinutes() + mins);
    return d;
  }

  function toMinutes(hhmm) {
    if (!hhmm) return null;
    const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function minutesToHHMM(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function minutesToLabel(mins) {
    if (mins === null || mins === undefined) return '';
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + (m ? ':' + String(m).padStart(2, '0') : '') + suffix;
  }

  // Subtract [bStart, bEnd) from every window in `windows`, splitting as needed.
  function subtractInterval(windows, bStart, bEnd) {
    if (bStart === null || bEnd === null || bEnd <= bStart) return windows;
    const result = [];
    windows.forEach(function (w) {
      if (bEnd <= w.start || bStart >= w.end) {
        result.push(w); // no overlap
        return;
      }
      if (bStart > w.start) result.push({ start: w.start, end: Math.min(bStart, w.end) });
      if (bEnd < w.end) result.push({ start: Math.max(bEnd, w.start), end: w.end });
    });
    return result.filter(function (w) { return w.end > w.start; });
  }

  function mergeIntervals(windows) {
    const sorted = windows.slice().sort(function (a, b) { return a.start - b.start; });
    const merged = [];
    sorted.forEach(function (w) {
      const last = merged[merged.length - 1];
      if (last && w.start <= last.end) {
        last.end = Math.max(last.end, w.end);
      } else {
        merged.push({ start: w.start, end: w.end });
      }
    });
    return merged;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
