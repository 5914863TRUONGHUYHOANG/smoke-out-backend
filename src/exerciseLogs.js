import { tx } from './db.js';
import { verifyExercise } from './verification.js';
import { awardAiExercise } from './points/service.js';
import { kstDate } from './points/policy.js';

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

async function reward(c, log) {
  const completedDate = kstDate(log.completed_at);
  await c.query(`INSERT INTO daily_summaries(user_id,date,exercise_minutes_total) VALUES($1,$3,$2)
    ON CONFLICT (user_id,date) DO UPDATE SET exercise_minutes_total=daily_summaries.exercise_minutes_total+$2`,
    [log.user_id, log.duration_completed, completedDate]);
  if (!log.recommendation_id) return { granted: 0, reason: 'NOT_AI_RECOMMENDED' };
  return awardAiExercise(c, {
    userId: log.user_id,
    exerciseLogId: log.exercise_log_id,
    completedAt: log.completed_at,
  });
}

async function apply(c, log, exercise) {
  const verification = await evaluate(c, log, exercise);
  await c.query(
    `UPDATE exercise_logs SET verification_status=$2, verification_reason=$3, verified_at=now()
     WHERE exercise_log_id=$1`,
    [log.exercise_log_id, verification.status, verification.reason]);
  const points = verification.status === 'VERIFIED'
    ? await reward(c, log)
    : { granted: 0, reason: verification.status };
  return { ...verification, points };
}

export function createExerciseLog(userId, body) {
  return tx(async (c) => {
    const { rows: [exercise] } = await c.query(
      'SELECT * FROM exercises WHERE exercise_id=$1 AND is_active',
      [body.exerciseId]);
    if (!exercise) throw Object.assign(new Error('exercise not found'), { status: 404 });

    let symptomLogId = body.symptomLogId ?? null;
    if (body.recommendationId) {
      const { rows: [recommendation] } = await c.query(
        `SELECT *, expires_at > now() AS valid
         FROM ai_recommendations WHERE recommendation_id=$1 AND user_id=$2 FOR UPDATE`,
        [body.recommendationId, userId]);
      if (!recommendation || Number(recommendation.exercise_id) !== body.exerciseId) {
        throw Object.assign(new Error('invalid recommendation'), { status: 400 });
      }
      if (!recommendation.valid) {
        throw Object.assign(new Error('recommendation expired'), { status: 400 });
      }
      symptomLogId ??= recommendation.symptom_log_id;
    }
    if (symptomLogId) {
      const { rowCount } = await c.query(
        'SELECT 1 FROM symptom_logs WHERE symptom_log_id=$1 AND user_id=$2',
        [symptomLogId, userId]);
      if (!rowCount) throw Object.assign(new Error('symptom log not found'), { status: 404 });
    }

    const { rows: [log] } = await c.query(
      `INSERT INTO exercise_logs
         (user_id,exercise_id,symptom_log_id,recommendation_id,duration_completed,intensity_after,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        userId, body.exerciseId, symptomLogId, body.recommendationId ?? null,
        body.durationCompleted, body.intensityAfter ?? null, body.startedAt, body.completedAt,
      ]);
    const result = await apply(c, log, exercise);
    return { exerciseLogId: log.exercise_log_id, ...result };
  });
}

export async function reverifyPending(c, userId) {
  const { rows } = await c.query(
    `SELECT l.*, e.duration_minutes, e.intensity
     FROM exercise_logs l JOIN exercises e USING(exercise_id)
     WHERE l.user_id=$1 AND l.verification_status='PENDING' AND l.started_at IS NOT NULL
     ORDER BY l.completed_at FOR UPDATE OF l`,
    [userId]);
  const results = [];
  for (const log of rows) {
    results.push({ exerciseLogId: log.exercise_log_id, ...(await apply(c, log, log)) });
  }
  return results;
}
