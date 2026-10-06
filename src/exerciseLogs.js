import { tx } from './db.js';
import { verifyExercise, pointsFor } from './verification.js';

const OVERLAP_Q = `SELECT 1 FROM exercise_sessions WHERE user_id=$1 AND exercise_log_id <> COALESCE($4,-1)
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

async function award(c, userId, logId, completedAt, minutes, isAiRecommended) {
  let awarded = 0;
  if (isAiRecommended) {
    await c.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [userId]);
    const { rows: [daily] } = await c.query(
      `SELECT COALESCE(SUM(points), 0)::integer AS points
       FROM point_logs
       WHERE user_id=$1 AND point_type='AI_EXERCISE'
         AND earned_on=($2::timestamptz AT TIME ZONE 'UTC')::date`,
      [userId, completedAt]
    );
    const pts = pointsFor(daily.points);
    if (pts > 0) {
      const { rowCount } = await c.query(
        `INSERT INTO point_logs(user_id,point_type,points,reference_key,earned_on)
         VALUES($1,'AI_EXERCISE',$2,$3,($4::timestamptz AT TIME ZONE 'UTC')::date)
         ON CONFLICT (user_id,point_type,reference_key) DO NOTHING`,
        [userId, pts, `exercise-${logId}`, completedAt]
      );
      if (rowCount > 0) awarded = pts;
    }
  }
  await c.query(`INSERT INTO daily_summaries(user_id,date,exercise_minutes_total) VALUES($1,CURRENT_DATE,$2)
    ON CONFLICT (user_id,date) DO UPDATE SET exercise_minutes_total=daily_summaries.exercise_minutes_total+$2`, [userId, minutes]);
  return awarded;
}

async function apply(c, log, exercise) {
  const v = await evaluate(c, log, exercise);
  await c.query(`UPDATE exercise_sessions SET verification_status=$2, verification_reason=$3, verified_at=now() WHERE exercise_log_id=$1`,
    [log.exercise_log_id, v.status, v.reason]);
  const pointsAwarded = v.status === 'VERIFIED'
    ? await award(c, log.user_id, log.exercise_log_id, log.completed_at, log.duration_completed, exercise.is_ai_recommended)
    : 0;
  return { ...v, pointsAwarded };
}

export function createExerciseLog(userId, b) {
  return tx(async (c) => {
    const { rows: [ex] } = await c.query('SELECT * FROM exercises WHERE exercise_id=$1', [b.exerciseId]);
    if (!ex) throw Object.assign(new Error('exercise not found'), { status: 404 });
    if (typeof ex.is_ai_recommended !== 'boolean') {
      throw new Error('exercises.is_ai_recommended is missing; apply the ranking schema migration');
    }
    if (b.symptomLogId) {
      const { rowCount } = await c.query('SELECT 1 FROM symptom_logs WHERE symptom_log_id=$1 AND user_id=$2', [b.symptomLogId, userId]);
      if (!rowCount) throw Object.assign(new Error('symptom log not found'), { status: 404 });
    }
    const { rows: [log] } = await c.query(
      `INSERT INTO exercise_sessions(user_id,exercise_id,symptom_log_id,duration_completed,intensity_after,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [userId, b.exerciseId, b.symptomLogId ?? null, b.durationCompleted, b.intensityAfter ?? null, b.startedAt, b.completedAt]);
    const v = await apply(c, log, ex);
    return { exerciseLogId: log.exercise_log_id, ...v };
  });
}

// 헬스 데이터가 새로 들어오면 PENDING 기록을 재검증
export async function reverifyPending(c, userId) {
  const { rows } = await c.query(
    `SELECT l.*, e.duration_minutes, e.intensity, e.is_ai_recommended FROM exercise_sessions l JOIN exercises e USING(exercise_id)
     WHERE l.user_id=$1 AND l.verification_status='PENDING' AND l.started_at IS NOT NULL
     ORDER BY l.completed_at FOR UPDATE OF l`, [userId]);
  const out = [];
  for (const r of rows) out.push({ exerciseLogId: r.exercise_log_id, ...(await apply(c, r, r)) });
  return out;
}
