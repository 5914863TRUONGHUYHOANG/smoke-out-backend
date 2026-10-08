import { tx } from './db.js';
import { verifyExercise } from './verification.js';
import { awardAiExercise } from './points/service.js';

const OVERLAP_Q = `SELECT 1 FROM exercise_logs WHERE user_id=$1 AND exercise_log_id <> COALESCE($4,-1)
  AND started_at IS NOT NULL AND started_at < $3 AND completed_at > $2 LIMIT 1`;

async function evaluate(c, log, exercise) {
  const { rows: health } = await c.query(
    `SELECT started_at, ended_at, avg_heart_rate FROM health_records
     WHERE user_id=$1 AND started_at < $3 AND ended_at > $2`,
    [log.user_id, log.started_at, log.completed_at]);
  const { rowCount } = await c.query(OVERLAP_Q,
    [log.user_id, log.started_at, log.completed_at, log.exercise_log_id ?? null]);
  return verifyExercise({
    exercise, health, overlapsOtherLog: rowCount > 0,
    startedAt: new Date(log.started_at), completedAt: new Date(log.completed_at),
    durationCompleted: log.duration_completed,
  });
}

// 검증 통과 후 보상: 운동 시간 집계(모든 검증된 운동) + 포인트(AI 추천 운동만)
async function reward(c, log) {
  await c.query(`INSERT INTO daily_summaries(user_id,date,exercise_minutes_total) VALUES($1,$3,$2)
    ON CONFLICT (user_id,date) DO UPDATE SET exercise_minutes_total=daily_summaries.exercise_minutes_total+$2`,
    [log.user_id, log.duration_completed, new Date(log.completed_at).toISOString().slice(0, 10)]);
  if (!log.recommendation_id) return { granted: 0, reason: 'NOT_AI_RECOMMENDED' };
  return awardAiExercise(c, { userId: log.user_id, exerciseLogId: log.exercise_log_id, completedAt: log.completed_at });
}

async function apply(c, log, exercise) {
  const v = await evaluate(c, log, exercise);
  await c.query(`UPDATE exercise_logs SET verification_status=$2, verification_reason=$3, verified_at=now() WHERE exercise_log_id=$1`,
    [log.exercise_log_id, v.status, v.reason]);
  const points = v.status === 'VERIFIED' ? await reward(c, log) : { granted: 0, reason: v.status };
  return { ...v, points };
}

export function createExerciseLog(userId, b) {
  return tx(async (c) => {
    const { rows: [ex] } = await c.query('SELECT * FROM exercises WHERE exercise_id=$1', [b.exerciseId]);
    if (!ex) throw Object.assign(new Error('exercise not found'), { status: 404 });

    let symptomLogId = b.symptomLogId ?? null;
    if (b.recommendationId) {
      const { rows: [rec] } = await c.query(
        'SELECT *, expires_at > now() AS valid FROM ai_recommendations WHERE recommendation_id=$1 AND user_id=$2 FOR UPDATE',
        [b.recommendationId, userId]);
      if (!rec || Number(rec.exercise_id) !== b.exerciseId)
        throw Object.assign(new Error('invalid recommendation'), { status: 400 });
      if (!rec.valid) throw Object.assign(new Error('recommendation expired'), { status: 400 });
      symptomLogId ??= rec.symptom_log_id; // 추천 때 기록한 증상과 자동 연결
    }
    if (symptomLogId) {
      const { rowCount } = await c.query('SELECT 1 FROM symptom_logs WHERE symptom_log_id=$1 AND user_id=$2', [symptomLogId, userId]);
      if (!rowCount) throw Object.assign(new Error('symptom log not found'), { status: 404 });
    }
    const { rows: [log] } = await c.query(
      `INSERT INTO exercise_logs(user_id,exercise_id,symptom_log_id,recommendation_id,duration_completed,intensity_after,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userId, b.exerciseId, symptomLogId, b.recommendationId ?? null, b.durationCompleted, b.intensityAfter ?? null, b.startedAt, b.completedAt]);
    const v = await apply(c, log, ex);
    return { exerciseLogId: log.exercise_log_id, ...v };
  });
}

// 헬스 데이터가 새로 들어오면 PENDING 기록을 재검증 (이때 AI 추천 운동이면 포인트도 지급됨)
export async function reverifyPending(c, userId) {
  const { rows } = await c.query(
    `SELECT l.*, e.duration_minutes, e.intensity FROM exercise_logs l JOIN exercises e USING(exercise_id)
     WHERE l.user_id=$1 AND l.verification_status='PENDING' AND l.started_at IS NOT NULL
     ORDER BY l.completed_at FOR UPDATE OF l`, [userId]);
  const out = [];
  for (const r of rows) out.push({ exerciseLogId: r.exercise_log_id, ...(await apply(c, r, r)) });
  return out;
}
