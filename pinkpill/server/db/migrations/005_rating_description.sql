-- New description for the Rating forum (only if it still has the original text, so admin edits are kept).
UPDATE forums SET description = 'Get genuine face ratings, thoughtful feedback on your appearance, and personalised tips to help you enhance your natural beauty.'
WHERE id = 'f-rating' AND description = 'Opt-in, constructive ratings and feedback on your pics. Be kind or be banned.';
