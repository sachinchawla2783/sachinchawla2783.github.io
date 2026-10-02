-- Starter accounts the owner can add (and later remove in one click) so a new forum isn't empty.
ALTER TABLE users ADD COLUMN starter boolean NOT NULL DEFAULT false;
