/**
 * Site configuration. Edit these values to make the site yours — no other
 * code changes are needed for basic customization.
 */
const CONFIG = {
  // Paste the Web app URL you get from deploying apps-script/Code.gs here.
  // It looks like: https://script.google.com/macros/s/AKfycb.../exec
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbxvVrI7TWa60ALR0N6aeRrzCDnXFyhqCuixNazwOIF7Uxypg2mfDa7MVFF2XF9XC6tUxQ/exec',

  siteName: 'Is Rob Free?',
  tagline: "Check my schedule, pick a time, and let's do something.",
  ownerFirstName: 'Rob',
  timezoneLabel: 'Eastern Time',

  // How many days ahead to show in the "When I'm Free" view.
  daysAhead: 14,

  // Default daily window, used for every day UNLESS the Availability sheet
  // has a recurring "Free" row for that weekday. You don't need to list
  // "Free" rows at all anymore — every day starts open across this range,
  // and "Busy" rows (recurring by weekday, or one-off on a specific date)
  // carve chunks out of it. Use '00:00' / '24:00' if you really do want the
  // whole day open by default (including overnight).
  defaultDayStart: '08:00',
  defaultDayEnd: '22:00',

  // Accent color used throughout the site (hex).
  accentColor: '#ff6b6b',

  // ----- Time-slot picker (in the "Request a time" modal) -----
  // Block lengths (in minutes) offered when someone picks "Pick a time block".
  slotDurationOptions: [30, 60, 90, 120],
  // Which of the above is selected by default.
  defaultSlotDuration: 60,
  // Spacing (in minutes) between selectable start times within a free window.
  // Smaller = more granular start-time choices.
  slotStepMinutes: 30,
};
