-- 포인트 정책용 스키마 (02_health.sql 이후)
BEGIN;

-- AI가 서버에서 발급한 추천. 클라이언트가 "AI 추천 운동"이라고 주장하는 것을 막기 위함
CREATE TABLE ai_recommendations (
    recommendation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    exercise_id BIGINT NOT NULL REFERENCES exercises(exercise_id),
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    expires_at  TIMESTAMP NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX idx_ai_reco_user ON ai_recommendations(user_id, created_at DESC);

-- 추천 1건당 운동 기록 1건만 연결 (재사용 방지)
ALTER TABLE exercise_logs
  ADD COLUMN recommendation_id BIGINT UNIQUE REFERENCES ai_recommendations(recommendation_id);

-- 멱등성 키: 같은 보상이 두 번 지급되지 않도록 DB가 보장
-- earned_on: 포인트가 귀속되는 날짜(KST). 일일 한도 집계 기준
ALTER TABLE point_logs
  ADD COLUMN idempotency_key VARCHAR(120),
  ADD COLUMN earned_on DATE NOT NULL DEFAULT CURRENT_DATE;
CREATE UNIQUE INDEX uq_point_logs_idem ON point_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_point_logs_daily ON point_logs(user_id, point_type, earned_on);

COMMIT;
