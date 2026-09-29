-- PinkPill initial schema
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- roles & permissions ----------
CREATE TABLE roles (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z_]{2,32}$'),
  title       text NOT NULL,
  rank        integer NOT NULL UNIQUE,          -- higher = more powerful
  is_staff    boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (
  role_id     text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  text NOT NULL CHECK (permission ~ '^[a-z_]+\.[a-z_]+$'),
  PRIMARY KEY (role_id, permission)
);

-- ---------- users ----------
CREATE TABLE users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username           citext NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9_.-]{3,24}$' OR status = 'deleted'),
  email              citext UNIQUE,
  password_hash      text,
  role_id            text NOT NULL DEFAULT 'member' REFERENCES roles(id),
  status             text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'active', 'deleted')),
  email_verified_at  timestamptz,
  failed_logins      integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  read_all_at        timestamptz,
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  activity_type      text,
  activity_ref       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_last_seen_idx ON users (last_seen_at DESC);
CREATE INDEX users_created_idx ON users (created_at DESC);

CREATE TABLE attachments (
  id           uuid PRIMARY KEY,
  owner_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  purpose      text NOT NULL CHECK (purpose IN ('avatar', 'banner', 'post')),
  storage_key  text NOT NULL UNIQUE,
  mime         text NOT NULL CHECK (mime IN ('image/webp')),
  bytes        integer NOT NULL CHECK (bytes > 0),
  width        integer NOT NULL,
  height       integer NOT NULL,
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_owner_idx ON attachments (owner_id);

CREATE TABLE profiles (
  user_id       bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  custom_title  text NOT NULL DEFAULT '' CHECK (length(custom_title) <= 50),
  bio           text NOT NULL DEFAULT '' CHECK (length(bio) <= 5000),
  location      text NOT NULL DEFAULT '' CHECK (length(location) <= 50),
  website       text NOT NULL DEFAULT '' CHECK (length(website) <= 200),
  birthday      date,
  signature     text NOT NULL DEFAULT '' CHECK (length(signature) <= 1000),
  avatar_id     uuid REFERENCES attachments(id) ON DELETE SET NULL,
  banner_id     uuid REFERENCES attachments(id) ON DELETE SET NULL,
  avatar_color  text NOT NULL DEFAULT '#ec4899' CHECK (avatar_color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TABLE user_preferences (
  user_id              bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme                text NOT NULL DEFAULT 'auto' CHECK (theme IN ('auto', 'light', 'dark')),
  show_online          boolean NOT NULL DEFAULT true,
  allow_dms            text NOT NULL DEFAULT 'everyone' CHECK (allow_dms IN ('everyone', 'followed', 'none')),
  allow_profile_posts  text NOT NULL DEFAULT 'everyone' CHECK (allow_profile_posts IN ('everyone', 'followed', 'none')),
  show_signatures      boolean NOT NULL DEFAULT true,
  auto_watch           boolean NOT NULL DEFAULT true
);

-- ---------- auth ----------
CREATE TABLE sessions (
  id            text PRIMARY KEY,                -- sha256(token), hex
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    text NOT NULL,
  persistent    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            inet,
  user_agent    text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE email_verifications (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id);

CREATE TABLE password_resets (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- ---------- forum structure ----------
CREATE TABLE categories (
  id        text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  title     text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  position  integer NOT NULL DEFAULT 0
);

CREATE TABLE forums (
  id              text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  category_id     text NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  parent_id       text REFERENCES forums(id) ON DELETE RESTRICT,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  description     text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  icon            text NOT NULL DEFAULT '💬' CHECK (length(icon) <= 8),
  position        integer NOT NULL DEFAULT 0,
  staff_only      boolean NOT NULL DEFAULT false,   -- only staff may start threads
  members_only    boolean NOT NULL DEFAULT false,   -- hidden from guests
  rating_enabled  boolean NOT NULL DEFAULT false,
  notice          text NOT NULL DEFAULT '' CHECK (length(notice) <= 500),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX forums_category_idx ON forums (category_id);
CREATE INDEX forums_parent_idx ON forums (parent_id);

-- ---------- threads & posts ----------
CREATE TABLE threads (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  forum_id        text NOT NULL REFERENCES forums(id) ON DELETE RESTRICT,
  author_id       bigint REFERENCES users(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 150),
  prefix          text CHECK (prefix IN ('question','discussion','guide','routine','rateme','glowup','research','serious','vent')),
  sticky          boolean NOT NULL DEFAULT false,
  locked          boolean NOT NULL DEFAULT false,
  rating_enabled  boolean NOT NULL DEFAULT false,
  view_count      integer NOT NULL DEFAULT 0,
  reply_count     integer NOT NULL DEFAULT 0,
  first_post_id   bigint,
  last_post_id    bigint,
  last_post_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  title_search    tsvector GENERATED ALWAYS AS (to_tsvector('english', title)) STORED
);
CREATE INDEX threads_forum_list_idx ON threads (forum_id, sticky DESC, last_post_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX threads_author_idx ON threads (author_id);
CREATE INDEX threads_last_post_idx ON threads (last_post_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX threads_title_search_idx ON threads USING gin (title_search);

CREATE TABLE thread_tags (
  thread_id  bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  tag        text NOT NULL CHECK (tag ~ '^[a-z0-9-]{1,30}$'),
  PRIMARY KEY (thread_id, tag)
);
CREATE INDEX thread_tags_tag_idx ON thread_tags (tag);

CREATE TABLE posts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id      bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  content        text NOT NULL CHECK (length(content) BETWEEN 1 AND 20000),
  rating         smallint CHECK (rating BETWEEN 1 AND 10),
  created_at     timestamptz NOT NULL DEFAULT now(),
  edited_at      timestamptz,
  edited_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  edit_reason    text NOT NULL DEFAULT '' CHECK (length(edit_reason) <= 100),
  deleted_at     timestamptz,
  deleted_by     bigint REFERENCES users(id) ON DELETE SET NULL,
  delete_reason  text NOT NULL DEFAULT '' CHECK (length(delete_reason) <= 100),
  search         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX posts_thread_idx ON posts (thread_id, created_at, id);
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC);
CREATE INDEX posts_created_idx ON posts (created_at DESC);
CREATE INDEX posts_search_idx ON posts USING gin (search);
-- one rating per member per thread
CREATE UNIQUE INDEX posts_one_rating_idx ON posts (thread_id, author_id) WHERE rating IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE threads ADD CONSTRAINT threads_first_post_fk FOREIGN KEY (first_post_id) REFERENCES posts(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE threads ADD CONSTRAINT threads_last_post_fk FOREIGN KEY (last_post_id) REFERENCES posts(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE post_revisions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  content     text NOT NULL,
  editor_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_revisions_post_idx ON post_revisions (post_id, created_at);

CREATE TABLE reactions (
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction    text NOT NULL CHECK (reaction IN ('like','love','glow','haha','wow','hug','sad')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX reactions_user_idx ON reactions (user_id);

CREATE TABLE reputation (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id      bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  giver_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value        integer NOT NULL CHECK (value <> 0 AND value BETWEEN -10 AND 10),
  comment      text NOT NULL DEFAULT '' CHECK (length(comment) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, giver_id),
  CHECK (giver_id <> receiver_id)
);
CREATE INDEX reputation_receiver_idx ON reputation (receiver_id, created_at DESC);
CREATE INDEX reputation_giver_idx ON reputation (giver_id, created_at DESC);

-- ---------- polls ----------
CREATE TABLE polls (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id       bigint NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
  question        text NOT NULL CHECK (length(question) BETWEEN 1 AND 200),
  allow_multiple  boolean NOT NULL DEFAULT false,
  closes_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poll_id   bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text      text NOT NULL CHECK (length(text) BETWEEN 1 AND 100),
  position  integer NOT NULL,
  UNIQUE (poll_id, position),
  UNIQUE (poll_id, id)
);

CREATE TABLE poll_votes (
  poll_id     bigint NOT NULL,
  option_id   bigint NOT NULL,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id),
  -- the option must belong to the poll the vote claims
  FOREIGN KEY (poll_id, option_id) REFERENCES poll_options(poll_id, id) ON DELETE CASCADE
);
CREATE INDEX poll_votes_poll_user_idx ON poll_votes (poll_id, user_id);

-- ---------- per-user thread state ----------
CREATE TABLE thread_watches (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id   bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX thread_watches_thread_idx ON thread_watches (thread_id);

CREATE TABLE thread_reads (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id  bigint NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE bookmarks (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ---------- social ----------
CREATE TABLE follows (
  follower_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);

CREATE TABLE ignores (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ignored_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ignored_id),
  CHECK (user_id <> ignored_id)
);
CREATE INDEX ignores_ignored_idx ON ignores (ignored_id);

CREATE TABLE profile_posts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id        bigint REFERENCES users(id) ON DELETE SET NULL,
  content          text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  search           tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX profile_posts_profile_idx ON profile_posts (profile_user_id, created_at DESC);
CREATE INDEX profile_posts_author_idx ON profile_posts (author_id);
CREATE INDEX profile_posts_search_idx ON profile_posts USING gin (search);

CREATE TABLE profile_post_comments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_post_id  bigint NOT NULL REFERENCES profile_posts(id) ON DELETE CASCADE,
  author_id        bigint REFERENCES users(id) ON DELETE SET NULL,
  content          text NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_post_comments_pp_idx ON profile_post_comments (profile_post_id, created_at);

CREATE TABLE profile_post_reactions (
  profile_post_id  bigint NOT NULL REFERENCES profile_posts(id) ON DELETE CASCADE,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction         text NOT NULL CHECK (reaction IN ('like','love','glow','haha','wow','hug','sad')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_post_id, user_id)
);

-- ---------- conversations ----------
CREATE TABLE conversations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  starter_id       bigint REFERENCES users(id) ON DELETE SET NULL,
  allow_invite     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id  bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  last_read_at     timestamptz,
  starred          boolean NOT NULL DEFAULT false,
  left_at          timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_participants_user_idx ON conversation_participants (user_id);

CREATE TABLE conversation_messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id  bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id        bigint REFERENCES users(id) ON DELETE SET NULL,
  content          text NOT NULL CHECK (length(content) BETWEEN 1 AND 20000),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_messages_conv_idx ON conversation_messages (conversation_id, created_at, id);

-- ---------- notifications ----------
CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  type        text NOT NULL,
  text        text NOT NULL CHECK (length(text) <= 400),
  link        text NOT NULL DEFAULT '#/alerts' CHECK (link ~ '^#/'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ---------- moderation ----------
CREATE TABLE reports (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id      bigint REFERENCES users(id) ON DELETE SET NULL,   -- NULL = automatic safety filter
  content_type     text NOT NULL CHECK (content_type IN ('post', 'profile_post', 'message', 'user')),
  content_id       bigint NOT NULL,
  reason           text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolved_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  resolution_note  text NOT NULL DEFAULT '' CHECK (length(resolution_note) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_content_idx ON reports (content_type, content_id);

CREATE TABLE bans (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  expires_at  timestamptz,                -- NULL = permanent; otherwise a suspension
  lifted_at   timestamptz,
  lifted_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bans_user_idx ON bans (user_id, created_at DESC);

CREATE TABLE warnings (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  points      integer NOT NULL CHECK (points BETWEEN 1 AND 10),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX warnings_user_idx ON warnings (user_id, created_at DESC);

CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id);

-- ---------- misc ----------
CREATE TABLE user_trophies (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trophy_id   text NOT NULL,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trophy_id)
);

CREATE TABLE site_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- reference data ----------
INSERT INTO roles (id, title, rank, is_staff) VALUES
  ('member', 'Registered member', 10, false),
  ('moderator', 'Moderator', 50, true),
  ('admin', 'Administrator', 80, true),
  ('super_admin', 'Super administrator', 100, true);

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.perm
FROM roles r
CROSS JOIN (VALUES
  ('thread.create'), ('post.reply'), ('post.edit_own'), ('post.delete_own'), ('post.react'),
  ('rep.give'), ('rep.give_negative'), ('poll.create'), ('poll.vote'), ('conversation.start'),
  ('upload.image'), ('report.create'), ('profile_post.create')
) AS p(perm);

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.perm
FROM roles r
CROSS JOIN (VALUES
  ('mod.view_reports'), ('mod.edit_any'), ('mod.delete_any'), ('mod.view_deleted'), ('mod.lock'),
  ('mod.sticky'), ('mod.move'), ('mod.warn'), ('mod.ban'), ('mod.view_log'), ('forum.post_staff_only')
) AS p(perm)
WHERE r.id IN ('moderator', 'admin', 'super_admin');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.perm
FROM roles r
CROSS JOIN (VALUES ('admin.users'), ('admin.forums'), ('admin.settings'), ('admin.stats'), ('admin.import')) AS p(perm)
WHERE r.id IN ('admin', 'super_admin');

INSERT INTO role_permissions (role_id, permission) VALUES ('super_admin', 'admin.permissions');

INSERT INTO site_settings (key, value) VALUES
  ('site_name', '"PinkPill"'),
  ('site_description', '"The looksmaxxing forum for women — skincare, hair, makeup, fitness, style & confidence."'),
  ('registration_open', 'true'),
  ('flood_seconds', '10'),
  ('rep_daily_limit', '10'),
  ('neg_rep_min_posts', '10'),
  ('max_poll_options', '20');

-- ---------- forum structure (from the prototype) ----------
INSERT INTO categories (id, title, position) VALUES
  ('c-info', 'Information', 0), ('c-looks', 'Looksmaxxing', 1), ('c-rating', 'Rating', 2),
  ('c-community', 'Community', 3), ('c-offtopic', 'Off-Topic', 4);

INSERT INTO forums (id, category_id, parent_id, title, description, icon, position, staff_only, members_only, rating_enabled, notice) VALUES
  ('f-news', 'c-info', NULL, 'News', 'Beauty, health and science news worth knowing about.', '📰', 0, true, false, false, ''),
  ('f-announce', 'c-info', NULL, 'Announcements', 'Site updates, rule changes and events.', '📣', 1, true, false, false, ''),
  ('f-looks', 'c-looks', NULL, 'Looksmaxxing', 'General looksmaxxing discussion, plus sub-forums for every area.', '🌸', 0, false, false, false, ''),
  ('f-questions', 'c-looks', NULL, 'Looksmaxxing Questions', 'Ask anything about looksmaxxing — no question is too basic.', '❓', 10, false, false, false, ''),
  ('f-rating', 'c-rating', NULL, 'Rating', 'Opt-in, constructive ratings and feedback on your pics. Be kind or be banned.', '⭐', 0, false, false, true, ''),
  ('f-intro', 'c-community', NULL, 'Introductions', 'New here? Say hi and tell us about your goals.', '👋', 0, false, false, false, ''),
  ('f-advice', 'c-community', NULL, 'Situations & Dating Advice', 'Get advice on your problems, life situations, dating and relationships. Be supportive.', '💌', 1, false, false, false,
     'Be kind and supportive. Keep other people anonymous: no names, photos or screenshots of them. If you''re unsafe in a relationship, see the support resources.'),
  ('f-success', 'c-community', NULL, 'Glow-Ups & Success Stories', 'Before & afters, progress logs, wins.', '🏆', 2, false, false, false, ''),
  ('f-wellbeing', 'c-community', NULL, 'Mental Health & Confidence', 'Body image, self-esteem, support. Resources pinned.', '🫶', 3, false, false, false, ''),
  ('f-feedback', 'c-community', NULL, 'Site Feedback & Bugs', 'Suggestions and bug reports for PinkPill.', '🛠️', 4, false, false, false, ''),
  ('f-offtopic', 'c-offtopic', NULL, 'Off-Topic', 'Anything not about looks: music, shows, life, memes. Keep it civil.', '☕', 0, false, false, false, '');

INSERT INTO forums (id, category_id, parent_id, title, description, icon, position, staff_only, members_only, rating_enabled) VALUES
  ('f-skin', 'c-looks', 'f-looks', 'Skincare', 'Routines, actives, acne, anti-aging, SPF.', '🧴', 1, false, false, false),
  ('f-hair', 'c-looks', 'f-looks', 'Hair, Brows & Lashes', 'Growth, colour, cuts, care and styling.', '💇‍♀️', 2, false, false, false),
  ('f-makeup', 'c-looks', 'f-looks', 'Makeup', 'Techniques, products, colour analysis, face-shape tips.', '💄', 3, false, false, false),
  ('f-fitness', 'c-looks', 'f-looks', 'Fitness', 'Training programs, strength, cardio, posture work.', '🏋️‍♀️', 4, false, false, false),
  ('f-body', 'c-looks', 'f-looks', 'Body', 'Body composition, proportions, posture, body care — sustainably.', '🧘‍♀️', 5, false, false, false),
  ('f-nutrition', 'c-looks', 'f-looks', 'Nutrition & Health', 'Evidence-based eating, sleep, hormones. No crash diets.', '🥗', 6, false, false, false),
  ('f-face', 'c-looks', 'f-looks', 'Facial Aesthetics', 'Face shape, harmony, orthodontics, jawline.', '💎', 7, false, false, false),
  ('f-style', 'c-looks', 'f-looks', 'Style & Fashion', 'Wardrobe, colour seasons, body-type dressing, fragrance.', '👗', 8, false, false, false),
  ('f-procedures', 'c-looks', 'f-looks', 'Cosmetic Procedures', 'Research & experiences with licensed professionals only.', '🩺', 9, false, false, false),
  ('f-private-rating', 'c-rating', 'f-rating', 'Private Ratings', 'Only visible to logged-in members. Hidden from guests and search engines.', '🔒', 1, false, true, true);
