-- Remove the Community category. Introductions, Success Stories and Mental Health become thread
-- prefixes (intro, success, mentalhealth); their threads are kept, moved and labelled. Situations &
-- Dating Advice and VIP Supporters (still VIP-only) move into Looksmaxxing; Site Feedback into Information.
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_prefix_check;
ALTER TABLE threads ADD CONSTRAINT threads_prefix_check CHECK (prefix IN (
  'question', 'lifefuel', 'discussion', 'blackpill', 'redpill', 'mogs', 'whitepill', 'bluepill', 'guide', 'serious',
  'success', 'motivation', 'rage', 'looksmax', 'news', 'jfl', 'theory', 'venting', 'over', 'cope', 'slay', 'rateme',
  'intro', 'mentalhealth'));

UPDATE threads SET forum_id = 'f-offtopic', prefix = coalesce(prefix, 'intro') WHERE forum_id = 'f-intro';
UPDATE threads SET forum_id = 'f-looks', prefix = coalesce(prefix, 'success') WHERE forum_id = 'f-success';
UPDATE threads SET forum_id = 'f-offtopic', prefix = coalesce(prefix, 'mentalhealth') WHERE forum_id = 'f-wellbeing';

-- Any sub-forums an admin created under the removed forums move up a level first.
UPDATE forums SET parent_id = NULL WHERE parent_id IN ('f-intro', 'f-success', 'f-wellbeing');
DELETE FROM forums WHERE id IN ('f-intro', 'f-success', 'f-wellbeing');

UPDATE forums SET category_id = 'c-looks', parent_id = NULL, position = 11 WHERE id = 'f-advice';
UPDATE forums SET category_id = 'c-looks', parent_id = NULL, position = 12, vip_only = true, members_only = true WHERE id = 'f-vip';
UPDATE forums SET category_id = 'c-info', parent_id = NULL, position = 2 WHERE id = 'f-feedback';
-- Anything else left in Community (e.g. forums added by an admin) goes to Off-Topic.
UPDATE forums SET category_id = 'c-offtopic' WHERE category_id = 'c-community';
DELETE FROM categories WHERE id = 'c-community';
