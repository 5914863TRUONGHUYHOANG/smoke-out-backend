-- 운동검증 + 헬스 연동용 추가 스키마 (init.sql 이후 실행)
BEGIN;

ALTER TABLE exercise_logs
  ADD COLUMN started_at          TIMESTAMP,
  ADD COLUMN verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
  ADD COLUMN verification_reason TEXT,
  ADD COLUMN verified_at         TIMESTAMP;
CREATE INDEX idx_exercise_logs_status ON exercise_logs(user_id, verification_status);

CREATE TABLE health_records (
    health_record_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider         VARCHAR(30) NOT NULL,      -- APPLE_HEALTH / HEALTH_CONNECT / FITBIT ...
    external_id      VARCHAR(100) NOT NULL,
    activity_type    VARCHAR(50),
    started_at       TIMESTAMP NOT NULL,
    ended_at         TIMESTAMP NOT NULL,
    avg_heart_rate   INT,
    max_heart_rate   INT,
    steps            INT,
    calories         INT,
    raw              JSONB,
    UNIQUE (provider, external_id),
    CHECK (ended_at > started_at)
);
CREATE INDEX idx_health_records_user_time ON health_records(user_id, started_at);

CREATE TABLE health_connections (
    user_id       BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider      VARCHAR(30) NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TIMESTAMP,
    PRIMARY KEY (user_id, provider)
);

COMMIT;
