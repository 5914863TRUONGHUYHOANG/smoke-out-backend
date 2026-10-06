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

-- AI-recommended exercises are explicitly marked before they can earn points.
CREATE TABLE IF NOT EXISTS exercises (
    exercise_id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    intensity VARCHAR(20) NOT NULL CHECK (intensity IN ('LOW', 'MEDIUM', 'HIGH')),
    is_ai_recommended BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE IF EXISTS exercises
    ADD COLUMN IF NOT EXISTS is_ai_recommended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS symptom_logs (
    symptom_log_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    symptom_type VARCHAR(100) NOT NULL,
    intensity_before INT NOT NULL CHECK (intensity_before BETWEEN 0 AND 10),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS smoke_logs (
    smoke_log_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    cigarettes_smoked INT NOT NULL CHECK (cigarettes_smoked > 0),
    trigger_cause TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exercise_sessions (
    exercise_log_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    exercise_id BIGINT NOT NULL REFERENCES exercises(exercise_id),
    symptom_log_id BIGINT REFERENCES symptom_logs(symptom_log_id),
    duration_completed INT NOT NULL CHECK (duration_completed > 0),
    intensity_after INT CHECK (intensity_after BETWEEN 0 AND 10),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    verification_reason TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exercise_sessions_user_completed
    ON exercise_sessions(user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS health_records (
    health_record_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL CHECK (provider IN ('APPLE_HEALTH', 'HEALTH_CONNECT', 'FITBIT', 'MANUAL')),
    external_id TEXT NOT NULL,
    activity_type VARCHAR(120),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
    avg_heart_rate INT,
    max_heart_rate INT,
    steps INT,
    calories INT,
    raw JSONB,
    CONSTRAINT unique_health_external_record UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_health_records_user_time
    ON health_records(user_id, started_at, ended_at);

CREATE TABLE IF NOT EXISTS health_connections (
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, provider)
);

-- Point ledger is the source of truth for exercise caps, milestones, and rankings.
CREATE TABLE IF NOT EXISTS point_logs (
    point_log_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    point_type VARCHAR(30) NOT NULL CHECK (point_type IN ('AI_EXERCISE', 'QUIT_MILESTONE')),
    points INT NOT NULL CHECK (points > 0),
    reference_key VARCHAR(120) NOT NULL,
    earned_on DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_point_reference UNIQUE (user_id, point_type, reference_key)
);
CREATE INDEX IF NOT EXISTS idx_point_logs_user_earned_on
    ON point_logs(user_id, earned_on, point_type);

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
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS date DATE;
UPDATE daily_summaries SET date = summary_date WHERE date IS NULL;
ALTER TABLE daily_summaries ALTER COLUMN date SET NOT NULL;
ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS exercise_minutes_total INT NOT NULL DEFAULT 0;
ALTER TABLE daily_summaries ALTER COLUMN summary_date SET DEFAULT CURRENT_DATE;
CREATE UNIQUE INDEX IF NOT EXISTS unique_daily_summary_user_date ON daily_summaries(user_id, date);

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
