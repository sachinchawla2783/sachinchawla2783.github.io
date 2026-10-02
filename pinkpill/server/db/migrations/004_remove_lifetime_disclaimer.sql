-- Remove the "Lifetime means the lifetime of the forum." disclaimer from the lifetime packages
-- (and the matching wording in their descriptions). Other notes are kept.
UPDATE vip_products SET notes = notes - 'Lifetime means the lifetime of the forum.', updated_at = now()
WHERE notes ? 'Lifetime means the lifetime of the forum.';
UPDATE vip_products SET description = 'Lifetime VIP with the Lifetime verified badge.', updated_at = now()
WHERE slug = 'lifetime-vip' AND description = 'VIP for the lifetime of the forum, with the Lifetime verified badge.';
UPDATE vip_products SET description = 'Lifetime VIP+ with the Lifetime verified badge.', updated_at = now()
WHERE slug = 'lifetime-vip-plus' AND description = 'VIP+ for the lifetime of the forum, with the Lifetime verified badge.';
