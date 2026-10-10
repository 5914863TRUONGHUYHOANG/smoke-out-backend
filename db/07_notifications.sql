BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE fcm_device_tokens (
    fcm_token  TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_fcm_device_tokens_user_id ON fcm_device_tokens(user_id);

CREATE TABLE notification_outbox (
    notification_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notification_type VARCHAR(30) NOT NULL CHECK (notification_type IN ('INACTIVITY', 'QUIT_MILESTONE')),
    notification_key  VARCHAR(120) NOT NULL,
    title             VARCHAR(200) NOT NULL,
    body              TEXT NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED')),
    attempts          INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until      TIMESTAMPTZ,
    sent_at           TIMESTAMPTZ,
    last_error        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_notification UNIQUE (user_id, notification_type, notification_key)
);
CREATE INDEX idx_notification_outbox_pending
  ON notification_outbox(status, next_attempt_at, created_at);

COMMIT;
