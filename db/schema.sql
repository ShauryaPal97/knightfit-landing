-- Knight Fit admin schema. Idempotent: safe to run again (npm run db:migrate).

CREATE TABLE IF NOT EXISTS visitors (
  id               text PRIMARY KEY,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  landing_url      text,
  referrer         text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  campaign_id      text,
  adset_id         text,
  ad_id            text,
  placement        text,
  site_source_name text,
  fbclid           text,
  fbc              text,
  fbp              text,
  ip               text,
  country          text,
  region           text,
  city             text,
  user_agent       text,
  device           text,
  screen           text,
  language         text,
  timezone         text,
  total_sessions   integer NOT NULL DEFAULT 0,
  total_events     integer NOT NULL DEFAULT 0,
  vsl_seconds      integer NOT NULL DEFAULT 0,
  vsl_pct          integer NOT NULL DEFAULT 0,
  furthest_step    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS visitors_last_seen ON visitors (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS visitors_first_seen ON visitors (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS visitors_campaign ON visitors (utm_campaign);

CREATE TABLE IF NOT EXISTS events (
  id          bigserial PRIMARY KEY,
  visitor_id  text NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  session_id  text,
  type        text NOT NULL,
  name        text,
  path        text,
  scroll_pct  integer,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_visitor ON events (visitor_id, created_at);
CREATE INDEX IF NOT EXISTS events_type ON events (type, created_at);
CREATE INDEX IF NOT EXISTS events_created ON events (created_at);

CREATE TABLE IF NOT EXISTS leads (
  id                     text PRIMARY KEY,
  visitor_id             text REFERENCES visitors(id) ON DELETE SET NULL,
  source                 text NOT NULL DEFAULT 'application', -- application | booking | manual
  stage                  text NOT NULL DEFAULT 'applied',     -- applied | booked | showed | closed | no_show | lost | disqualified
  archived_at            timestamptz,
  name                   text,
  email                  text,
  phone                  text,
  instagram              text,
  answers                jsonb,
  dq_reason              text,
  cta_source             text,
  attribution            jsonb,
  utm_source             text,
  utm_campaign           text,
  utm_term               text,
  utm_content            text,
  campaign_id            text,
  adset_id               text,
  ad_id                  text,
  amount_paid            numeric(12,2),
  currency               text NOT NULL DEFAULT 'USD',
  plan                   text,
  lead_source            text,                                -- ad | organic | referral | dm | other
  submit_event_id        text,
  lead_event_id          text,
  schedule_event_id      text,
  fbc                    text,
  fbp                    text,
  ip                     text,
  user_agent             text,
  event_source_url       text,
  meta_lead_sent_at      timestamptz,
  meta_schedule_sent_at  timestamptz,
  meta_purchase_sent_at  timestamptz,
  closed_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_visitor ON leads (visitor_id);
CREATE INDEX IF NOT EXISTS leads_email ON leads (lower(email));

CREATE TABLE IF NOT EXISTS lead_notes (
  id          bigserial PRIMARY KEY,
  lead_id     text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  note        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead ON lead_notes (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  uid             text PRIMARY KEY,
  lead_id         text REFERENCES leads(id) ON DELETE SET NULL,
  visitor_id      text REFERENCES visitors(id) ON DELETE SET NULL,
  title           text,
  start_time      timestamptz,
  end_time        timestamptz,
  attendee_name   text,
  attendee_email  text,
  attendee_phone  text,
  status          text NOT NULL DEFAULT 'accepted',            -- accepted | cancelled | rescheduled | no_show | showed
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_start ON bookings (start_time);
CREATE INDEX IF NOT EXISTS bookings_lead ON bookings (lead_id);

CREATE TABLE IF NOT EXISTS meta_sends (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  event_name   text NOT NULL,
  event_id     text,
  origin       text NOT NULL,                                  -- auto | manual
  status       text NOT NULL,                                  -- sent | failed | held | skipped
  lead_id      text,
  visitor_id   text,
  http_status  integer,
  response     jsonb,
  custom_data  jsonb,
  test_code    text
);
CREATE INDEX IF NOT EXISTS meta_sends_created ON meta_sends (created_at DESC);
CREATE INDEX IF NOT EXISTS meta_sends_lead ON meta_sends (lead_id);

CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  text
);
