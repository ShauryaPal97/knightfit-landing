/* Knight Fit site config — the only file you should need to edit for launch. */
window.KF_CONFIG = {
  // Meta Pixel ID (Events Manager → Data sources). Leave '' to disable the browser pixel.
  // The Conversions API token lives server-side in Vercel env vars, never here.
  PIXEL_ID: '1421889260122179',

  // Wistia media ID for the hero VSL (e.g. 'hbt4xagwap'). Leave '' to show the "video coming soon" frame.
  VSL_WISTIA_ID: '',
  // Optional poster image URL for the VSL (Wistia thumbnail). Falls back to Wistia's auto thumbnail.
  VSL_POSTER: '',

  // Cal.com booking link for qualified applicants: the part after cal.com/, e.g. 'knightnakanishi/consult'.
  // Leave '' until the Cal.com account exists; /booking then shows an Instagram DM fallback.
  CAL_LINK: 'knight-fit/60min',
  // Brand colour used inside the Cal.com calendar.
  CAL_BRAND: '#ff4a2e',

  // Where disqualified applicants are sent for free content.
  INSTAGRAM_URL: 'https://www.instagram.com/knightnakanishi/',

  // Minimum applicant age; younger applicants see the "not the right time" screen.
  MIN_AGE: 23,

  // Serverless endpoints (Vercel /api functions).
  TRACK_ENDPOINT: '/api/track',   // analytics + Meta Conversions API mirror
  LEAD_ENDPOINT: '/api/lead',

  // Logs every tracking call to the console. Turn off for launch.
  DEBUG: false
};
