# Knight Fit — VSL landing page

Static, mobile-first landing page for Meta ad traffic. Flow:

```
Ad → index.html (VSL + inline application form) → qualified → /booking (Cal.com) → /thank-you
                                          → disqualified → "not the right time" screen (Instagram link)
```

## Files

| Path | What it is |
|---|---|
| `index.html` | Landing page (headline, VSL, inline application form, then results, client videos, offer, about, final CTA) |
| `booking.html` | Cal.com inline embed, prefilled with name/email; passes visitor id, application id + UTMs as booking metadata |
| `thank-you.html` | Post-booking page |
| `privacy.html`, `tos.html` | Legal pages (copied from the old knightfit.io) |
| `assets/js/config.js` | **The file to edit**: Pixel ID, VSL video + thumbnail, Cal.com link, min age |
| `assets/js/tracking.js` | Meta Pixel + Conversions API mirror, UTM / ad id / fbclid capture, `_fbc`/`_fbp` cookies, first-party visitor analytics |
| `assets/js/app.js` | Inline application form (questions, validation, disqualify rules, submit), videos, sticky CTA |
| `assets/css/site.css` | All styles (mobile-first) |
| `admin/` | Admin panel at `/admin` (overview, visitors, leads, bookings, settings) |
| `api/track.js` | Visitor analytics in + Meta Conversions API mirror (respects the auto-send switches) |
| `api/lead.js` | Stores each application as a lead, emails an alert, hands qualified applicants to SMSLoop, forwards to `LEAD_WEBHOOK_URL` if set |
| `api/cal-webhook.js` | Cal.com booking webhook → bookings + lead stage, and tells SMSLoop (booked / no-show / cancelled) |
| `api/admin.js` | Every admin operation (password-protected) |
| `api/_*.js` | Shared helpers (database, Meta sender, auth, email, SMSLoop); not deployed as routes |
| `smsloop/scenarios.json` | Knight's SMSLoop scenarios (prompts, first texts, follow-ups); load with `python -m app.seed_scenarios` |
| `db/schema.sql` | Database tables; apply with `npm run db:migrate` |
| `scripts/dev.mjs` | Local server that runs the site + `/api` exactly like Vercel |
| `mockups/` | Design mockups (not deployed) |

## Admin panel (`/admin`)

What it does:
- **Overview**: visitors, applications, qualified, calls booked, show rate, closed, revenue. Funnel from landing to close, VSL watch time and drop-off, application drop-off by question, and a **campaign / ad set / ad table** (visitors → applied → booked → closed → revenue).
- **Visitors**: everyone who landed, with campaign / ad set / ad, city, device, how long they watched the VSL and how far they got. Click one for the full timeline (pages, sections, clicks, video, every answer, booking).
- **Leads / Archived**: every application (qualified and disqualified) and every Cal.com booking. Stage (Applied → Booked → Showed → Closed / No-show / Lost / Disqualified), answers, deal fields, notes, and **Send to Meta** buttons for Lead, Schedule and Purchase (amount in USD).
- **Bookings**: upcoming / past / cancelled Cal.com calls. Mark Showed / No-show.
- **Settings**: switch automatic sending off per event (SubmitApplication, Lead, DisqualifiedLead, Schedule). When off, the event is *held* and you send it from the lead. Also: Meta test code, "exclude my browser" (turn on for everyone who tests the page), setup checks, CSV export, delete all data.

### Setup (once)
1. **Database**: Vercel → project → Storage → Create → **Neon** (Postgres) → connect to this project. Copy the pooled `DATABASE_URL` into a local `.env`, then run `npm install` and `npm run db:migrate`.
2. **Env vars** on Vercel (see `.env.example`): `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (`openssl rand -hex 32`), `META_PIXEL_ID`, `META_CAPI_TOKEN`, `CAL_WEBHOOK_SECRET`, `SMTP_USER`, `SMTP_PASS` (optional: `ALERT_EMAIL_TO` as a fallback recipient list).
3. **Cal.com**: create the event, put its link in `config.js` → `CAL_LINK` (e.g. `knightnakanishi/consult`). Then Settings → Developer → Webhooks → New:
   - Subscriber URL: `https://knightfit.io/api/cal-webhook`
   - Secret: same value as `CAL_WEBHOOK_SECRET`
   - Triggers: Booking created, Booking rescheduled, Booking cancelled, Booking no-show updated
4. **Gmail alerts**: on the sending Gmail account, turn on 2-Step Verification, create an **App password**, put it in `SMTP_PASS`. Then in **Admin → Settings → Email alerts**, add who gets alerts (up to 20 emails) and pick per person: new application, disqualified application, call booked, call cancelled. **Send test email** checks the setup. `ALERT_EMAIL_TO` is only used while that list is empty.
5. **Ads Manager → each ad → Tracking → URL parameters** (paste exactly):
   ```
   utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}
   ```
   Without this, visitors still show up but with no campaign / ad set / ad. `utm_source` shows fb / ig / msg / an; placement shows as "Medium" on a visitor. The three `_id` params are optional but keep stats right if you rename a campaign, ad set or ad.
6. **Phone notifications** (iPhone app): run `npx web-push generate-vapid-keys` once and put the two keys in `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` on Vercel, then redeploy. On the iPhone (iOS 16.4+): open `/admin` in **Safari** → Share → **Add to Home Screen** → open **Knight** from the home screen → sign in → **Settings → Phone notifications → Turn on**. Each device picks its alerts: new application, disqualified, call booked (and rescheduled), cancelled, no-show. **Send test** checks it. Tapping a notification opens that lead. Login lasts 90 days.

### How the Meta buttons work
- Lead and Schedule reuse the browser's original event ID when there is one, so Meta merges a manual send with any automatic copy instead of counting twice. Original event time is used if it's under 7 days old.
- Purchase is only ever sent manually, with the amount you enter (USD).
- Manual sends use the lead's hashed email, phone and name plus the click id (`fbc`), browser id (`fbp`), IP and user agent captured when they visited.

## Run locally

```bash
node scripts/dev.mjs
```

Open http://localhost:3000 (or pass a port: `node scripts/dev.mjs 3100`). Copy `.env.example` to `.env`; a local Postgres works for `DATABASE_URL` (`createdb knight`, then `npm run db:migrate`).

## Deploy to Vercel

1. Push this folder to a GitHub repo, then **Vercel → Add New → Project → Import** (framework preset: **Other**, no build command).
2. **Settings → Environment Variables**, add:
   - `META_PIXEL_ID`: your pixel ID
   - `META_CAPI_TOKEN`: Events Manager → pixel → Settings → Conversions API → *Generate access token*
   - `LEAD_WEBHOOK_URL`: where applications go (GHL inbound webhook, Zapier, Make, Apps Script…)
   - optional `META_TEST_EVENT_CODE` (for testing only), `LEAD_WEBHOOK_SECRET`
   - `SMSLOOP_URL` + `SMSLOOP_SECRET`: AI texting (see below)
3. Put the same pixel ID in `assets/js/config.js` → `PIXEL_ID`, and set `DEBUG: false`.
4. Point `knightfit.io` at the Vercel project (Settings → Domains).

`.vercelignore` keeps `mockups/`, `scripts/` and the full-size original images off the live site.

## AI texting (SMSLoop)

Knight's SMSLoop deployment (separate Railway app, Sendblue number) texts every qualified applicant:

| What happened | Knight sends | SMSLoop does |
|---|---|---|
| Qualified application | `POST /leads/inbound` with `scenario: "not_booked"` + the form answers | Waits 15 min, then texts: asks about goals, struggles, what they tried, and pushes them to book |
| Call booked (or rescheduled) | `POST /leads/event` `set_scenario: "booked"` + call time | Swaps a pending "not booked" text for a warm-up text in 1-2 min; mid-chat it switches to the warm-up prompt |
| No-show marked in Cal.com | `set_scenario: "no_show"` | Texts after ~30 min to rebook, no guilt |
| Booking cancelled | `event: "ai_off"` | AI stops, coach gets a dashboard bell + email to take over |

Disqualified applicants are never texted. Cal.com bookings without a qualified application (direct link, disqualified) are ignored entirely: no lead, no alert, no text. Both env vars unset = nothing is sent.

Setup:
1. Deploy SMSLoop for Knight (its README), connect Sendblue, copy **Settings → Integrations → Lead source** secret into `SMSLOOP_SECRET` and the service URL into `SMSLOOP_URL`.
2. Replace `https://cal.com/REPLACE-WITH-KNIGHTS-CAL-LINK` in `smsloop/scenarios.json` (two prompts), then on the SMSLoop service: `python -m app.seed_scenarios scenarios.json` (or paste them into the dashboard). Re-running updates them; the old prompt stays as "Load Last Saved Prompt".

## Tracking

Every event fires on the browser pixel **and** server-side (CAPI) with the same `event_id`, so Meta dedupes them.

| Event | Fires when | Use it for |
|---|---|---|
| `PageView` | Every page load | Audiences |
| `ViewContent` | VSL starts playing | Video-viewer audiences |
| `VideoProgress` (custom) | VSL hits 25/50/75/95% | Drop-off analysis |
| `TestimonialPlay` (custom) | A client story video plays | |
| `ApplyClick` (custom) | Any Apply button tapped (`source` = header / final / sticky) | Which CTA works |
| `ApplicationStart` (custom) | First answer in the form | Form engagement rate |
| `ApplicationStep` (custom) | Each question answered (`step_id`, `answer`) | Form drop-off |
| `SubmitApplication` | Every completed application | |
| **`Lead`** | **Qualified applications only** | **Optimize ads on this** |
| `DisqualifiedLead` (custom) | 20 or under, or not ready to invest | Exclusion audience |
| **`Schedule`** | Call booked in Cal.com | Optimize once volume allows |
| **`Purchase`** | Sent manually from /admin when a lead closes | Value-based optimization later |

- **Advanced matching**: after the contact step, email/phone/name are attached to all later events (pixel hashes in-browser; CAPI hashes server-side).
- **Attribution**: `utm_*`, `fbclid`, `gclid`, referrer and landing URL are saved as first-touch and last-touch, sent with every lead, and passed to Cal.com as UTMs + booking metadata.
- **Auto-send switches**: SubmitApplication, Lead, DisqualifiedLead and Schedule can be set to manual-only in /admin → Settings.

**Test before launch:** set `META_TEST_EVENT_CODE`, open the site with `?utm_source=test`, go through the application, and check **Events Manager → Test events**. Each event should show *Browser* and *Server*, deduplicated. Remove the test code afterwards.

## Lead payload (POSTed to `LEAD_WEBHOOK_URL`)

```json
{
  "application_id": "app_…", "submitted_at": "…", "lead_status": "qualified | disqualified",
  "dq_reason": null | "under_min_age" | "not_investing",
  "contact": { "name", "email", "phone", "instagram" },
  "answers": { "goal", "challenge", "tried_before[]", "invest", "age", "occupation" },
  "cta_source": "inline | header | final | sticky | deeplink",
  "attribution": { "first_touch": {…utm…}, "last_touch": {…utm…}, "visitor_id", "session_id" },
  "meta": { "submit_event_id", "lead_event_id" },
  "server": { "received_at", "ip", "user_agent", "fbp", "fbc" }
}
```

Without `LEAD_WEBHOOK_URL` set, leads are printed to **Vercel → Logs**, so nothing is lost while you set up the CRM.

## Swapping in the new VSL

The VSL is self-hosted (no Wistia account). Compress the new cut to 720p with the moov atom up front so it starts playing before it fully downloads:

```bash
ffmpeg -i VSL.mp4 -vf scale=-2:720 -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart assets/video/vsl.mp4
```

Then in `config.js` (thumbnail = 16:9 image in `assets/img`):

```js
VSL_SRC: '/assets/video/vsl.mp4',
VSL_POSTER: '/assets/img/vsl-poster.jpg'
```

Watch time, `ViewContent` and `VideoProgress` are tracked the same way as before. Bandwidth: Vercel Hobby includes 100 GB/month, roughly 5k full plays of a ~20 MB file.

## Launch checklist: confirm with Knight before ads go live

Copy on the page that comes from the **old site** and is marked [NEEDED] in the brief:
- [ ] ISSA Certified Personal Trainer and Sports Nutrition Specialist
- [ ] 5+ years coaching
- [ ] 200+ clients coached (the old site said both "100+" and "200+")
- [ ] Grew up in a Thai household with a single mom, lost his dad at 10
- [ ] Put on 50 pounds after losing family (timeline relative to football)

Client proof:
- [ ] Permission to use names/photos: Jorge, Meadow, Toss, Prong, and the 8 video clients
- [ ] Permission to feature **Alexis** (Putt Putt), **Camille** (@marlboromillie), **Jonathan** (@justearthz) with their results

Offer / compliance:
- [ ] "Limited coaching spots" is real (Meta reviews landing pages)
- [ ] Legal review of claims and disclaimers
- [ ] New ~5 min VSL recorded and uploaded
- [ ] `PIXEL_ID` set, `DEBUG: false`, env vars set on Vercel, test events verified on a real phone
- [ ] Cal.com account + event created, `CAL_LINK` set, webhook added (see Admin panel → Setup)
- [ ] SMSLoop deployed for Knight, `SMSLOOP_URL`/`SMSLOOP_SECRET` set, scenarios seeded with the real booking link, prompts reviewed by Knight, bot switched ON
- [ ] Cal.com event collects attendee phone number
- [ ] Cal.com booking tested end-to-end on a real phone (redirects to /thank-you, booking appears in /admin → Bookings)
- [ ] Neon database connected, `npm run db:migrate` run against it, admin env vars set
- [ ] Ads Manager URL parameters added to every ad
- [ ] `privacy.html` reviewed: the site now stores visit activity, IP address and approximate location per visitor
