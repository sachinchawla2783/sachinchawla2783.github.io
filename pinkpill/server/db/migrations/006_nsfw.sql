-- NSFW = content warning for mature or sensitive but non-explicit material (pornography and sexually
-- explicit material are not allowed at all). The tag is shown wherever a thread appears; it is not an
-- access restriction. nsfw_set_by records who set it so members can't remove a tag staff applied.
ALTER TABLE threads ADD COLUMN nsfw boolean NOT NULL DEFAULT false;
ALTER TABLE threads ADD COLUMN nsfw_set_by text CHECK (nsfw_set_by IN ('author', 'staff'));
CREATE INDEX threads_nsfw_idx ON threads (forum_id) WHERE nsfw;
