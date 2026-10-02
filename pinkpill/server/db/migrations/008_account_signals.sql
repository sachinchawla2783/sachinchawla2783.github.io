-- Sign-up and login signals for spotting alt accounts and ban evasion. Visible to administrators only.
-- device_id is a random ID the site stores in a long-lived cookie in each browser (not a hardware ID).
CREATE TABLE account_signals (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event        text NOT NULL CHECK (event IN ('register', 'login')),
  ip           inet,
  device_id    text CHECK (device_id ~ '^[A-Za-z0-9_-]{20,64}$'),
  device_name  text NOT NULL DEFAULT '' CHECK (length(device_name) <= 100),
  user_agent   text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 300),
  country      text CHECK (country ~ '^[A-Z]{2}$'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_signals_user_idx ON account_signals (user_id, created_at DESC);
CREATE INDEX account_signals_ip_idx ON account_signals (ip);
CREATE INDEX account_signals_device_idx ON account_signals (device_id);
CREATE INDEX account_signals_register_idx ON account_signals (created_at DESC) WHERE event = 'register';
