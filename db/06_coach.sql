-- AI coach conversation history (after 05_seed_exercises.sql)
BEGIN;
CREATE TABLE IF NOT EXISTS coach_messages (
    message_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role       VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
    content    TEXT NOT NULL,
    meta       JSONB,                       -- tools used, recommendation id (audit)
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_messages_user_time ON coach_messages(user_id, created_at DESC);
COMMIT;
