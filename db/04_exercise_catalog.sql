-- 운동 카탈로그 확장 + 추천 컨텍스트 (03_points.sql 이후)
-- 재실행 가능하도록 IF NOT EXISTS / IF EXISTS 사용
BEGIN;

-- 1) 운동 카탈로그: AI가 "검색/선택"하는 유일한 후보 집합
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS instructions       TEXT,
  ADD COLUMN IF NOT EXISTS target_symptoms    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_fitness_level  VARCHAR(20) NOT NULL DEFAULT 'BEGINNER',
  ADD COLUMN IF NOT EXISTS location           VARCHAR(10) NOT NULL DEFAULT 'ANY',
  ADD COLUMN IF NOT EXISTS requires_equipment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contraindications  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS craving_min        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS craving_max        INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS tags               TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active          BOOLEAN NOT NULL DEFAULT TRUE;

-- 기존 단일 컬럼(target_symptom)은 배열 컬럼으로 대체
UPDATE exercises SET target_symptoms = ARRAY[target_symptom]
  WHERE target_symptom IS NOT NULL AND target_symptoms = '{}';
DROP INDEX IF EXISTS idx_exercises_target_symptom;
ALTER TABLE exercises DROP COLUMN IF EXISTS target_symptom;

ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_title_key;
ALTER TABLE exercises ADD CONSTRAINT exercises_title_key UNIQUE (title);
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_level_chk;
ALTER TABLE exercises ADD CONSTRAINT exercises_level_chk
  CHECK (min_fitness_level IN ('BEGINNER','INTERMEDIATE','ADVANCED'));
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_location_chk;
ALTER TABLE exercises ADD CONSTRAINT exercises_location_chk
  CHECK (location IN ('ANY','INDOOR','OUTDOOR'));
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_craving_chk;
ALTER TABLE exercises ADD CONSTRAINT exercises_craving_chk
  CHECK (craving_min BETWEEN 0 AND 10 AND craving_max BETWEEN 0 AND 10 AND craving_min <= craving_max);
CREATE INDEX IF NOT EXISTS idx_exercises_symptoms ON exercises USING GIN (target_symptoms);
CREATE INDEX IF NOT EXISTS idx_exercises_active   ON exercises(is_active);

-- 2) 사용자 상태: 체력 수준은 기존 컬럼, 건강 주의사항 추가
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS health_flags TEXT[] NOT NULL DEFAULT '{}';
  -- 예: HEART_CONDITION, HYPERTENSION, ASTHMA, PREGNANCY, JOINT_PAIN, BACK_PAIN

-- 3) 증상 유형 제한 (AI 입력도 이 값만 허용)
ALTER TABLE symptom_logs DROP CONSTRAINT IF EXISTS symptom_logs_type_chk;
ALTER TABLE symptom_logs ADD CONSTRAINT symptom_logs_type_chk
  CHECK (symptom_type IN ('CRAVING','ANXIETY','IRRITABILITY','STRESS','INSOMNIA','FATIGUE','RESTLESSNESS','COUGH'));

-- 4) 추천 기록: 어떤 상태에서 왜 추천했는지 남김 (감사/개선용)
ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS symptom_log_id BIGINT REFERENCES symptom_logs(symptom_log_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS craving_level  INT,
  ADD COLUMN IF NOT EXISTS context        JSONB,
  ADD COLUMN IF NOT EXISTS reason         TEXT,
  ADD COLUMN IF NOT EXISTS source         VARCHAR(10) NOT NULL DEFAULT 'LLM'
      CHECK (source IN ('LLM','RULE'));

COMMIT;
