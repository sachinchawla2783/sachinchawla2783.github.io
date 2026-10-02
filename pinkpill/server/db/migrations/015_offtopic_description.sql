-- Drop "Keep it civil." from the Off-Topic description (only if an admin hasn't already changed it).
UPDATE forums SET description = 'Anything not about looks: music, shows, life, memes.'
WHERE id = 'f-offtopic' AND description = 'Anything not about looks: music, shows, life, memes. Keep it civil.';
