-- Quit-smoking app schema (PostgreSQL 14+)
BEGIN;

CREATE TABLE users (
    user_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email          VARCHAR(255) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    nickname       VARCHAR(50)  NOT NULL UNIQUE,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
    profile_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id               BIGINT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    quit_start_date       TIMESTAMP NOT NULL,
    daily_cigarette_count INT NOT NULL CHECK (daily_cigarette_count >= 0),
    pack_price            INT NOT NULL CHECK (pack_price >= 0),
    fitness_level         VARCHAR(20) NOT NULL DEFAULT 'BEGINNER'
        CHECK (fitness_level IN ('BEGINNER','INTERMEDIATE','ADVANCED'))
);

CREATE TABLE exercises (
    exercise_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title            VARCHAR(200) NOT NULL,
    category         VARCHAR(50)  NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    intensity        VARCHAR(20)  NOT NULL CHECK (intensity IN ('LOW','MEDIUM','HIGH')),
    target_symptom   VARCHAR(50),
    video_url        TEXT
);
CREATE INDEX idx_exercises_target_symptom ON exercises(target_symptom);

CREATE TABLE symptom_logs (
    symptom_log_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    symptom_type     VARCHAR(50) NOT NULL,
    intensity_before INT NOT NULL CHECK (intensity_before BETWEEN 0 AND 10),
    logged_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_symptom_logs_user_time ON symptom_logs(user_id, logged_at DESC);

CREATE TABLE exercise_logs (
    exercise_log_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id            BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    exercise_id        BIGINT NOT NULL REFERENCES exercises(exercise_id),
    symptom_log_id     BIGINT REFERENCES symptom_logs(symptom_log_id) ON DELETE SET NULL,
    duration_completed INT NOT NULL CHECK (duration_completed >= 0),
    intensity_after    INT CHECK (intensity_after BETWEEN 0 AND 10),
    completed_at       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_exercise_logs_user_time ON exercise_logs(user_id, completed_at DESC);
CREATE INDEX idx_exercise_logs_exercise  ON exercise_logs(exercise_id);
-- 증상 1건당 완화 운동 최대 1건 (1:0..1)
CREATE UNIQUE INDEX uq_exercise_logs_symptom
    ON exercise_logs(symptom_log_id) WHERE symptom_log_id IS NOT NULL;

CREATE TABLE smoke_logs (
    smoke_log_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    cigarettes_smoked INT NOT NULL CHECK (cigarettes_smoked > 0),
    trigger_cause     VARCHAR(100),
    logged_at         TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_smoke_logs_user_time ON smoke_logs(user_id, logged_at DESC);

CREATE TABLE daily_summaries (
    summary_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id                BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date                   DATE NOT NULL,
    is_smoke_free          BOOLEAN NOT NULL DEFAULT TRUE,
    saved_money            INT NOT NULL DEFAULT 0,
    exercise_minutes_total INT NOT NULL DEFAULT 0,
    UNIQUE (user_id, date)
);

CREATE TABLE point_logs (
    point_log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    point_type   VARCHAR(50) NOT NULL,
    points       INT NOT NULL,
    reference_id BIGINT,
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_point_logs_user_time ON point_logs(user_id, created_at DESC);

CREATE TABLE user_ranks (
    user_id        BIGINT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    total_points   INT NOT NULL DEFAULT 0,
    weekly_points  INT NOT NULL DEFAULT 0,
    monthly_points INT NOT NULL DEFAULT 0,
    current_rank   INT,
    weekly_rank    INT,
    updated_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_ranks_total  ON user_ranks(total_points DESC);
CREATE INDEX idx_user_ranks_weekly ON user_ranks(weekly_points DESC);

COMMIT;
