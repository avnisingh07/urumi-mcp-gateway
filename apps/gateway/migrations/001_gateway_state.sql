CREATE TABLE IF NOT EXISTS gateway_users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gateway_api_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES gateway_users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS gateway_upstreams (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  credential_ciphertext TEXT,
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 30000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_upstreams_name_unique ON gateway_upstreams (lower(name));

CREATE TABLE IF NOT EXISTS gateway_audit_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES gateway_users(id) ON DELETE SET NULL,
  upstream_id UUID REFERENCES gateway_upstreams(id) ON DELETE SET NULL,
  upstream_name TEXT,
  tool_name TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS gateway_audit_events_occurred_at_idx ON gateway_audit_events (occurred_at DESC);
