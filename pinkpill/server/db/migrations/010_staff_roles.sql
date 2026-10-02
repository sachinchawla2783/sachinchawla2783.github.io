-- Staff structure: Moderator < Admin < Global Admin < Owner. Only the owner (super_admin) assigns roles;
-- site settings, VIP/payments, imports and permissions stay owner-only.
UPDATE roles SET title = 'Owner' WHERE id = 'super_admin';
UPDATE roles SET title = 'Admin' WHERE id = 'admin';
INSERT INTO roles (id, title, rank, is_staff) VALUES ('global_admin', 'Global Admin', 90, true) ON CONFLICT (id) DO NOTHING;

-- Global admins get every member permission (same as registered members).
INSERT INTO role_permissions (role_id, permission)
SELECT 'global_admin', permission FROM role_permissions WHERE role_id = 'member'
ON CONFLICT DO NOTHING;

-- Reset staff permissions for the three delegated roles.
DELETE FROM role_permissions
WHERE role_id IN ('moderator', 'admin', 'global_admin')
  AND (permission LIKE 'mod.%' OR permission LIKE 'admin.%' OR permission = 'forum.post_staff_only');

INSERT INTO role_permissions (role_id, permission)
SELECT r.role_id, p.perm
FROM (VALUES ('moderator'), ('admin'), ('global_admin')) AS r(role_id)
CROSS JOIN (VALUES
  ('mod.view_reports'), ('mod.edit_any'), ('mod.delete_any'), ('mod.view_deleted'), ('mod.lock'),
  ('mod.sticky'), ('mod.move'), ('mod.warn'), ('mod.ban'), ('mod.view_log'), ('forum.post_staff_only')
) AS p(perm);

INSERT INTO role_permissions (role_id, permission)
SELECT r.role_id, 'admin.stats' FROM (VALUES ('admin'), ('global_admin')) AS r(role_id);

INSERT INTO role_permissions (role_id, permission) VALUES
  ('global_admin', 'admin.users'), ('global_admin', 'admin.forums');
