-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    quit_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    last_access_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_points INT DEFAULT 0 CHECK (total_points >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Upgrade existing databases as well as creating the column for new installations.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMP WITH TIME ZONE;
UPDATE users SET last_access_at = CURRENT_TIMESTAMP WHERE last_access_at IS NULL;
ALTER TABLE users ALTER COLUMN last_access_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ALTER COLUMN last_access_at SET NOT NULL;

-- Device tokens are keyed by token so one account can use multiple devices.
CREATE TABLE IF NOT EXISTS fcm_device_tokens (
    fcm_token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fcm_device_tokens_user_id ON fcm_device_tokens(user_id);

-- The outbox deduplicates scheduled notifications and retries transient FCM failures.
CREATE TABLE IF NOT EXISTS notification_outbox (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    notification_type VARCHAR(30) NOT NULL CHECK (notification_type IN ('INACTIVITY', 'QUIT_MILESTONE')),
    notification_key VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED')),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_notification UNIQUE (user_id, notification_type, notification_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
    ON notification_outbox(status, next_attempt_at, created_at);

-- 3. DAILY SUMMARIES TABLE
CREATE TABLE IF NOT EXISTS daily_summaries (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    cigs_smoked INT DEFAULT 0,
    money_saved NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_date UNIQUE (user_id, summary_date)
);

-- 4. CRAVING LOGS TABLE
CREATE TABLE IF NOT EXISTS craving_logs (
    craving_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    intensity_before INT NOT NULL CHECK (intensity_before BETWEEN 1 AND 10),
    intensity_after INT CHECK (intensity_after BETWEEN 1 AND 10),
    recommended_exercise VARCHAR(100),
    points_earned INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. EXERCISE LOGS TABLE
CREATE TABLE IF NOT EXISTS exercise_logs (
    exercise_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    exercise_type VARCHAR(100) NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    points_earned INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
