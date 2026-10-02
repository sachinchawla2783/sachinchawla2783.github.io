-- More special colours and effects; the owner can grant them to members (special_access).
-- Also guarantees at most one owner in the database itself, whatever the application does.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_special_color_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_special_effect_check;
ALTER TABLE users ADD CONSTRAINT users_special_color_check CHECK (special_color IN ('rainbow', 'galaxy', 'inferno', 'frost', 'royal', 'toxic', 'sakura', 'midnight', 'ocean', 'sunset', 'emerald', 'crimson', 'lavender', 'candy', 'aurora', 'chrome', 'peach', 'cyber', 'lava', 'mint', 'blush', 'storm', 'gold', 'nebula'));
ALTER TABLE users ADD CONSTRAINT users_special_effect_check CHECK (special_effect IN ('flow', 'pulse', 'sparkle', 'neon', 'glitch', 'float', 'flicker', 'prism', 'shadow', 'outline', 'hearts', 'crown', 'stars', 'fire', 'wave', 'glow'));
ALTER TABLE users ADD COLUMN special_access boolean NOT NULL DEFAULT false;

-- One owner, ever: a second active super_admin row is rejected by the database.
CREATE UNIQUE INDEX users_single_owner_idx ON users ((true)) WHERE role_id = 'super_admin' AND status <> 'deleted';
