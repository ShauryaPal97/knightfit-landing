/* Knight Fit site config — the only file you should need to edit for launch. */
window.KF_CONFIG = {
  // Meta Pixel ID (Events Manager → Data sources). Leave '' to disable the browser pixel.
  // The Conversions API token lives server-side in Vercel env vars, never here.
  PIXEL_ID: '1421889260122179',

  // Self-hosted hero VSL (720p MP4 in assets/video). Leave '' to show the "video coming soon" frame.
  VSL_SRC: '/assets/video/vsl.mp4',
  // Thumbnail shown before play (16:9 image in assets/img). Falls back to Knight's headshot.
  VSL_POSTER: '/assets/img/vsl-poster.jpg',

  // Cal.com booking link for qualified applicants: the part after cal.com/, e.g. 'knightnakanishi/consult'.
  // Leave '' until the Cal.com account exists; /booking then shows an Instagram DM fallback.
  CAL_LINK: 'team/knight-fit/coaching-gameplan-call',
  // Brand colour used inside the Cal.com calendar.
  CAL_BRAND: '#ff4a2e',

  // Where disqualified applicants are sent for free content.
  INSTAGRAM_URL: 'https://www.instagram.com/knightnakanishi/',

  // Minimum applicant age; younger applicants see the "not the right time" screen.
  MIN_AGE: 21,

  // Serverless endpoints (Vercel /api functions).
  TRACK_ENDPOINT: '/api/track',   // analytics + Meta Conversions API mirror
  LEAD_ENDPOINT: '/api/lead',

  // Logs every tracking call to the console. Turn off for launch.
  DEBUG: false
};
