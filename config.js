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
