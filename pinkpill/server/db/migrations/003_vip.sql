-- VIP memberships: products, orders, payments, entitlements, wallet, cosmetics.
-- Money is stored in integer cents. Nothing here trusts the browser: prices come from vip_products,
-- memberships are only created by the server after a payment is confirmed (or by an audited admin grant).

-- ---------- cosmetics catalogs (admin-configurable) ----------
CREATE TABLE vip_username_colors (
  id                  text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,30}$'),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  hex1                text NOT NULL CHECK (hex1 ~ '^#[0-9a-f]{6}$'),
  hex2                text CHECK (hex2 ~ '^#[0-9a-f]{6}$'),          -- set = gradient
  lifetime_exclusive  boolean NOT NULL DEFAULT false,                 -- only for products with exclusive_colors
  active              boolean NOT NULL DEFAULT true,
  position            integer NOT NULL DEFAULT 0
);

CREATE TABLE vip_avatar_frames (
  id        text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,30}$'),
  name      text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  hex       text NOT NULL CHECK (hex ~ '^#[0-9a-f]{6}$'),
  active    boolean NOT NULL DEFAULT true,
  position  integer NOT NULL DEFAULT 0
);

-- Effect ids map to predefined CSS classes in the frontend; users never submit CSS.
CREATE TABLE vip_username_effects (
  id        text PRIMARY KEY CHECK (id IN ('glow', 'shimmer', 'sparkle', 'outline')),
  name      text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  active    boolean NOT NULL DEFAULT true,
  position  integer NOT NULL DEFAULT 0
);

-- ---------- products ----------
CREATE TABLE vip_products (
  id                            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name                          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description                   text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  price_cents                   integer NOT NULL CHECK (price_cents BETWEEN 50 AND 10000000),
  annual_price_cents            integer CHECK (annual_price_cents BETWEEN 50 AND 10000000),
  currency                      text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_period                text NOT NULL CHECK (billing_period IN ('month', 'lifetime')),
  lifetime                      boolean NOT NULL,
  active                        boolean NOT NULL DEFAULT true,
  position                      integer NOT NULL DEFAULT 0,
  tier_rank                     integer NOT NULL DEFAULT 0,
  conversation_limit            integer CHECK (conversation_limit BETWEEN 2 AND 100),
  username_change_cooldown_days integer CHECK (username_change_cooldown_days BETWEEN 1 AND 3650),   -- NULL = no username changes
  vanity_url_cooldown_days      integer CHECK (vanity_url_cooldown_days BETWEEN 1 AND 3650),        -- NULL = no vanity URL
  post_edit_window_minutes      integer CHECK (post_edit_window_minutes BETWEEN 1 AND 525600),      -- NULL = site default
  allowed_username_colors       text[] NOT NULL DEFAULT '{}',
  exclusive_colors              boolean NOT NULL DEFAULT false,
  available_avatar_frames       text[] NOT NULL DEFAULT '{}',
  requires_avatar_frame         boolean NOT NULL DEFAULT false,
  custom_username_color         boolean NOT NULL DEFAULT false,
  custom_username_effects       boolean NOT NULL DEFAULT false,
  custom_reactions              boolean NOT NULL DEFAULT false,
  verified_badge                boolean NOT NULL DEFAULT false,
  no_ads                        boolean NOT NULL DEFAULT true,
  vip_forum_access              boolean NOT NULL DEFAULT true,
  ratings_thread_deletion       boolean NOT NULL DEFAULT true,
  supersedes                    text[] NOT NULL DEFAULT '{}',   -- slugs this product fully includes
  benefits                      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits) = 'array'),
  notes                         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notes) = 'array'),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CHECK (lifetime = (billing_period = 'lifetime')),
  CHECK (NOT lifetime OR annual_price_cents IS NULL),
  CHECK (NOT requires_avatar_frame OR cardinality(available_avatar_frames) > 0)
);

-- ---------- orders ----------
CREATE TABLE vip_orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  purchaser_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  recipient_id     bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id       bigint NOT NULL REFERENCES vip_products(id) ON DELETE RESTRICT,
  kind             text NOT NULL CHECK (kind IN ('purchase', 'renewal', 'upgrade', 'gift', 'admin_grant')),
  billing          text NOT NULL CHECK (billing IN ('month', 'year', 'lifetime', 'custom')),
  amount_cents     integer NOT NULL CHECK (amount_cents >= 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method   text NOT NULL CHECK (payment_method IN ('card', 'paypal', 'wallet', 'crypto', 'manual')),
  provider         text NOT NULL CHECK (provider IN ('stripe', 'paypal', 'coinbase', 'wallet', 'manual')),
  provider_ref     text CHECK (length(provider_ref) <= 200),     -- checkout session / order / charge id
  provider_txn_id  text CHECK (length(provider_txn_id) <= 200),  -- payment intent / capture / payment id
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  options          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  idempotency_key  text CHECK (idempotency_key ~ '^[0-9a-f-]{36}$'),
  failure_reason   text NOT NULL DEFAULT '' CHECK (length(failure_reason) <= 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  refunded_at      timestamptz,
  CHECK (kind <> 'gift' OR purchaser_id IS DISTINCT FROM recipient_id),
  CHECK ((provider = 'manual') = (payment_method = 'manual'))
);
CREATE UNIQUE INDEX vip_orders_idem_idx ON vip_orders (purchaser_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX vip_orders_ref_idx ON vip_orders (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX vip_orders_txn_idx ON vip_orders (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX vip_orders_purchaser_idx ON vip_orders (purchaser_id, created_at DESC);
CREATE INDEX vip_orders_recipient_idx ON vip_orders (recipient_id, created_at DESC);
CREATE INDEX vip_orders_status_idx ON vip_orders (status, created_at DESC);

-- Webhook deliveries already processed (idempotency across provider retries).
CREATE TABLE payment_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     text NOT NULL,
  event_id     text NOT NULL CHECK (length(event_id) <= 200),
  event_type   text NOT NULL CHECK (length(event_type) <= 100),
  order_id     bigint REFERENCES vip_orders(id) ON DELETE SET NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- ---------- memberships (entitlements) ----------
CREATE TABLE vip_memberships (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                 bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id              bigint NOT NULL REFERENCES vip_products(id) ON DELETE RESTRICT,
  order_id                bigint UNIQUE REFERENCES vip_orders(id) ON DELETE RESTRICT,
  status                  text NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'refunded')),
  purchase_date           timestamptz NOT NULL DEFAULT now(),
  starts_at               timestamptz NOT NULL DEFAULT now(),
  expiration_date         timestamptz,
  lifetime                boolean NOT NULL,
  payment_provider        text NOT NULL,
  payment_transaction_id  text,
  avatar_frame            text,
  username_color          text,
  custom_username_color   text CHECK (custom_username_color ~ '^#[0-9a-f]{6}$'),
  custom_username_effect  text,
  granted_by              bigint REFERENCES users(id) ON DELETE SET NULL,
  gifted_by               bigint REFERENCES users(id) ON DELETE SET NULL,
  upgraded_from_id        bigint REFERENCES vip_memberships(id) ON DELETE SET NULL,
  note                    text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- Lifetime memberships never have an expiration date; time-limited ones always do.
  CHECK (lifetime = (expiration_date IS NULL))
);
CREATE INDEX vip_memberships_user_idx ON vip_memberships (user_id, status);
CREATE INDEX vip_memberships_expiry_idx ON vip_memberships (expiration_date) WHERE status = 'active' AND NOT lifetime;

-- The member's current cosmetic choices; always re-validated against active entitlements when shown.
CREATE TABLE user_vip_prefs (
  user_id         bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username_color  text,
  avatar_frame    text,
  custom_color    text CHECK (custom_color ~ '^#[0-9a-f]{6}$'),
  custom_effect   text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- wallet ----------
CREATE TABLE user_wallets (
  user_id        bigint PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance_cents  bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency       text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents   bigint NOT NULL CHECK (amount_cents <> 0),
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  kind           text NOT NULL CHECK (kind IN ('credit', 'debit', 'refund', 'adjustment')),
  order_id       bigint REFERENCES vip_orders(id) ON DELETE SET NULL,
  actor_id       bigint REFERENCES users(id) ON DELETE SET NULL,
  reason         text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_transactions_user_idx ON wallet_transactions (user_id, created_at DESC);

-- ---------- per-user VIP state ----------
ALTER TABLE users ADD COLUMN username_changed_at timestamptz;
ALTER TABLE profiles ADD COLUMN vanity citext UNIQUE CHECK (vanity ~ '^[a-z0-9][a-z0-9_-]{2,29}$');
ALTER TABLE profiles ADD COLUMN vanity_changed_at timestamptz;

-- ---------- VIP-only forums ----------
ALTER TABLE forums ADD COLUMN vip_only boolean NOT NULL DEFAULT false;
INSERT INTO forums (id, category_id, parent_id, title, description, icon, position, staff_only, members_only, rating_enabled, vip_only) VALUES
  ('f-vip', 'c-community', NULL, 'VIP Supporters', 'Exclusive forum for members who support PinkPill with a VIP membership.', '👑', 5, false, true, false, true)
ON CONFLICT (id) DO NOTHING;

-- ---------- VIP+ custom reactions ----------
ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_reaction_check;
ALTER TABLE reactions ADD CONSTRAINT reactions_reaction_check
  CHECK (reaction IN ('like','love','glow','haha','wow','hug','sad','fire','crown','gem','butterfly'));

-- ---------- permissions & settings ----------
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'vip.purchase' FROM roles r ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'admin.vip' FROM roles r WHERE r.id IN ('admin', 'super_admin') ON CONFLICT DO NOTHING;

INSERT INTO site_settings (key, value) VALUES
  -- Non-VIP limits that VIP benefits raise. 0 = unlimited.
  ('post_edit_window_minutes', '60'),
  ('conversation_max_participants', '10'),
  ('ratings_delete_max_replies', '0'),
  ('vip_payment_methods', '{"card": true, "paypal": true, "wallet": true, "crypto": true}')
ON CONFLICT (key) DO NOTHING;

-- ---------- reference data ----------
-- Annual prices start unset (not offered) until an administrator configures them.
INSERT INTO vip_username_colors (id, name, hex1, hex2, lifetime_exclusive, position) VALUES
  ('red', 'Red', '#e11d48', NULL, false, 1),
  ('blue', 'Blue', '#2563eb', NULL, false, 2),
  ('yellow', 'Yellow', '#ca8a04', NULL, false, 3),
  ('green', 'Green', '#16a34a', NULL, false, 4),
  ('purple', 'Purple', '#9333ea', NULL, false, 5),
  ('cosmic', 'Cosmic', '#7c3aed', '#06b6d4', false, 6),
  ('rose-gold', 'Rose Gold', '#b76e79', '#f4c2a1', true, 7),
  ('aurora', 'Aurora', '#10b981', '#8b5cf6', true, 8);

INSERT INTO vip_avatar_frames (id, name, hex, position) VALUES
  ('blue', 'Blue', '#2563eb', 1), ('red', 'Red', '#e11d48', 2), ('green', 'Green', '#16a34a', 3), ('yellow', 'Yellow', '#eab308', 4);

INSERT INTO vip_username_effects (id, name, position) VALUES
  ('glow', 'Glow', 1), ('shimmer', 'Shimmer', 2), ('sparkle', 'Sparkle', 3), ('outline', 'Outline', 4);

INSERT INTO vip_products (slug, name, description, price_cents, annual_price_cents, billing_period, lifetime, position, tier_rank,
    conversation_limit, username_change_cooldown_days, vanity_url_cooldown_days, post_edit_window_minutes,
    allowed_username_colors, exclusive_colors, available_avatar_frames, requires_avatar_frame,
    custom_username_color, custom_username_effects, custom_reactions, verified_badge, supersedes, benefits, notes) VALUES
  ('vip', 'VIP', 'Support PinkPill and unlock the core VIP perks.', 800, NULL, 'month', false, 1, 10,
    15, 30, 60, NULL,
    '{red,blue,yellow,green}', false, '{}', false,
    false, false, false, false, '{}',
    '["No Ads", "Choose from Red, Blue, Yellow, or Green VIP username colors", "Change your username every 30 days", "Exclusive VIP Supporters subforum", "Create conversations with up to 15 people total", "Delete your own threads in the Ratings subforum without restrictions", "Vanity profile URL, changeable every 60 days"]',
    '[]'),
  ('vip-plus', 'VIP+', 'Everything in VIP, plus an avatar frame, more colors, custom reactions and a longer editing window.', 1700, NULL, 'month', false, 2, 20,
    25, 30, 60, 720,
    '{red,blue,yellow,green,purple,cosmic}', false, '{blue,red,green,yellow}', true,
    false, false, true, false, '{vip}',
    '["No Ads", "Red, Blue, Yellow, Green, Purple, and Cosmic VIP username colors", "Change your username every 30 days", "Exclusive VIP Supporters subforum", "Create conversations with up to 25 people total", "Delete your own threads in the Ratings subforum without restrictions", "12-hour post-editing window", "Vanity profile URL, changeable every 60 days", "Includes the selected avatar frame", "Custom reactions"]',
    '[]'),
  ('lifetime-vip', 'Lifetime VIP', 'VIP for the lifetime of the forum, with the Lifetime verified badge.', 8200, NULL, 'lifetime', true, 3, 30,
    15, 30, 60, NULL,
    '{red,blue,yellow,green}', true, '{}', false,
    false, false, true, true, '{vip}',
    '["Exclusive verified badge signifying Lifetime VIP", "No Ads", "Exclusive access to new, never-seen-before username colors", "Choose from Red, Blue, Yellow, or Green VIP username colors", "Change your username every 30 days", "Exclusive VIP Supporters subforum", "Create conversations with up to 15 people total", "Delete your own threads in the Ratings subforum without restrictions", "Vanity profile URL, changeable every 60 days", "Custom reactions"]',
    '["Lifetime means the lifetime of the forum."]'),
  ('lifetime-vip-plus', 'Lifetime VIP+', 'VIP+ for the lifetime of the forum, with the Lifetime verified badge.', 10800, NULL, 'lifetime', true, 4, 40,
    25, 30, 60, 720,
    '{red,blue,yellow,green,purple,cosmic}', true, '{blue,red,green,yellow}', true,
    false, false, true, true, '{vip,vip-plus,lifetime-vip}',
    '["Exclusive verified badge signifying Lifetime VIP", "No Ads", "Exclusive access to new, never-seen-before username colors", "Red, Blue, Yellow, Green, Purple, and Cosmic VIP username colors", "Change your username every 30 days", "Exclusive VIP Supporters subforum", "Create conversations with up to 25 people total", "Delete your own threads in the Ratings subforum without restrictions", "12-hour post-editing window", "Vanity profile URL, changeable every 60 days", "Includes the selected avatar frame", "Custom reactions"]',
    '["Lifetime means the lifetime of the forum."]'),
  ('lifetime-vip-plus-custom', 'Lifetime VIP+ Custom Color', 'Lifetime VIP+ with a username color of your choice and username text effects.', 20800, NULL, 'lifetime', true, 5, 50,
    25, 30, 30, 720,
    '{red,blue,yellow,green,purple,cosmic}', true, '{blue,red,green,yellow}', true,
    true, true, true, true, '{vip,vip-plus,lifetime-vip,lifetime-vip-plus}',
    '["Exclusive verified badge signifying Lifetime VIP", "No Ads", "Exclusive access to new, never-seen-before username colors", "Red, Blue, Yellow, Green, Purple, and Cosmic VIP username colors", "Custom username color of your choice", "Change your username every 30 days", "Exclusive VIP Supporters subforum", "Create conversations with up to 25 people total", "Delete your own threads in the Ratings subforum without restrictions", "12-hour post-editing window", "Includes the selected avatar frame", "Custom reactions", "Vanity profile URL, changeable every 30 days", "Custom username text effects"]',
    '["Lifetime means the lifetime of the forum.", "This package includes a custom username color of your choice."]');
