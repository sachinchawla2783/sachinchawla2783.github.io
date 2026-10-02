-- Owner-only username styling: a special colour and an optional effect (ids; the look lives in CSS).
ALTER TABLE users ADD COLUMN special_color text
  CHECK (special_color IN ('rainbow', 'galaxy', 'inferno', 'frost', 'royal', 'toxic', 'sakura', 'midnight'));
ALTER TABLE users ADD COLUMN special_effect text
  CHECK (special_effect IN ('flow', 'pulse', 'sparkle', 'neon'));
