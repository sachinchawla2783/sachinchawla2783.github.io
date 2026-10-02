-- Custom avatar frame color: a package flag plus the member's chosen color. The top tier
-- (Lifetime VIP+ Custom Color) includes it; admins can enable it on other packages.
ALTER TABLE vip_products ADD COLUMN custom_avatar_frame boolean NOT NULL DEFAULT false;
ALTER TABLE user_vip_prefs ADD COLUMN custom_frame text CHECK (custom_frame ~ '^#[0-9a-f]{6}$');
UPDATE vip_products SET custom_avatar_frame = true,
  benefits = CASE WHEN benefits ? 'Custom avatar frame color of your choice' THEN benefits
                  ELSE benefits || '["Custom avatar frame color of your choice"]'::jsonb END
  WHERE slug = 'lifetime-vip-plus-custom';
