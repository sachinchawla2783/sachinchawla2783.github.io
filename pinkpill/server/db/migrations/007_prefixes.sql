-- New thread prefix set. Old prefixes are mapped to the closest new one (or cleared).
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_prefix_check;
UPDATE threads SET prefix = CASE prefix
  WHEN 'routine' THEN 'guide' WHEN 'glowup' THEN 'success' WHEN 'research' THEN 'theory' WHEN 'vent' THEN 'venting'
  WHEN 'rateme' THEN NULL ELSE prefix END
WHERE prefix IN ('routine', 'glowup', 'research', 'vent', 'rateme');
ALTER TABLE threads ADD CONSTRAINT threads_prefix_check CHECK (prefix IN (
  'question', 'lifefuel', 'discussion', 'blackpill', 'redpill', 'mogs', 'whitepill', 'bluepill', 'guide', 'serious',
  'success', 'motivation', 'rage', 'looksmax', 'news', 'jfl', 'theory', 'venting', 'over', 'cope', 'slay'));
