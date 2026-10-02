-- "Best of the Best": a curated forum for top guides. Only holders of forum.curate (the owner and
-- global admins) can start threads there or move threads in or out; members can read and reply.
ALTER TABLE forums ADD COLUMN curated boolean NOT NULL DEFAULT false;

INSERT INTO forums (id, category_id, parent_id, title, description, icon, position, staff_only, members_only, rating_enabled, notice, curated)
VALUES ('f-best', 'c-looks', NULL, 'Best of the Best',
  'The best guides on PinkPill, hand-picked by the owner and global admins.', '🏅', -1, false, false, false,
  'Only the owner and global admins can add guides here. Found a great guide elsewhere? Report it with "Nominate for Best of the Best".', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission) VALUES ('super_admin', 'forum.curate'), ('global_admin', 'forum.curate')
ON CONFLICT DO NOTHING;
