-- Which content embeds which uploaded image. Image access is authorised through these references:
-- an image is visible to a user only if they can see at least one piece of content that embeds it
-- (or they uploaded it). Only the uploader's own images create references, so copying someone
-- else's private image URL into a public post does not make that image public.
CREATE TABLE attachment_refs (
  attachment_id  uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  ref_type       text NOT NULL CHECK (ref_type IN ('post', 'message', 'profile_post', 'profile')),
  ref_id         bigint NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attachment_id, ref_type, ref_id)
);
CREATE INDEX attachment_refs_ref_idx ON attachment_refs (ref_type, ref_id);

-- Backfill from existing content.
INSERT INTO attachment_refs (attachment_id, ref_type, ref_id)
SELECT a.id, 'post', p.id FROM posts p
JOIN attachments a ON a.owner_id = p.author_id AND a.purpose = 'post' AND strpos(p.content, '/media/' || a.id::text) > 0
ON CONFLICT DO NOTHING;

INSERT INTO attachment_refs (attachment_id, ref_type, ref_id)
SELECT a.id, 'message', m.id FROM conversation_messages m
JOIN attachments a ON a.owner_id = m.author_id AND a.purpose = 'post' AND strpos(m.content, '/media/' || a.id::text) > 0
ON CONFLICT DO NOTHING;

INSERT INTO attachment_refs (attachment_id, ref_type, ref_id)
SELECT a.id, 'profile_post', pp.id FROM profile_posts pp
JOIN attachments a ON a.owner_id = pp.author_id AND a.purpose = 'post' AND strpos(pp.content, '/media/' || a.id::text) > 0
ON CONFLICT DO NOTHING;

INSERT INTO attachment_refs (attachment_id, ref_type, ref_id)
SELECT a.id, 'profile', pr.user_id FROM profiles pr
JOIN attachments a ON a.owner_id = pr.user_id AND a.purpose = 'post' AND strpos(pr.bio || ' ' || pr.signature, '/media/' || a.id::text) > 0
ON CONFLICT DO NOTHING;
