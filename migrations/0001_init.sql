CREATE TABLE IF NOT EXISTS recoveries (
  id TEXT PRIMARY KEY,
  requester_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  injuries TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  situation TEXT NOT NULL,
  county TEXT NOT NULL,
  photo_urls_json TEXT NOT NULL DEFAULT '[]',
  attachment_notes_json TEXT NOT NULL DEFAULT '[]',
  attached_photo_count INTEGER NOT NULL DEFAULT 0,
  public_channel_id TEXT,
  public_message_id TEXT,
  thread_id TEXT,
  roster_message_id TEXT,
  closeout_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  outcome TEXT CHECK (
    outcome IS NULL
    OR outcome IN ('recovered', 'cancelled', 'declined', 'referred_to_tow')
  ),
  closed_by_discord_id TEXT,
  closed_by_name TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responders (
  recovery_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('responding', 'cant_make_it')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (recovery_id, discord_user_id),
  FOREIGN KEY (recovery_id) REFERENCES recoveries (id)
);

CREATE INDEX IF NOT EXISTS idx_responders_recovery ON responders (recovery_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  recovery_id TEXT,
  response_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction_receipts (
  interaction_id TEXT PRIMARY KEY,
  recovery_id TEXT,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sheet_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('claim', 'outcome')),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheet_outbox_attempts ON sheet_outbox (attempts);
