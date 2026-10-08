import { pool, tx } from '../db.js';
import { rankCandidates } from './ranking.js';
import { chooseWithLLM } from './llm.js';

const err = (status, message) => Object.assign(new Error(message), { status });

export async function recommend(userId, input) {
  // 1) 읽기 단계 (트랜잭션 불필요, LLM 호출 동안 커넥션을 잡지 않는다)
  const { rows: [profile] } = await pool.query(
    'SELECT fitness_level, health_flags FROM user_profiles WHERE user_id=$1', [userId]);
  if (!profile) throw err(404, 'profile not found');

  const [{ rows: exercises }, { rows: recent }, { rows: eff }] = await Promise.all([
    pool.query('SELECT * FROM exercises WHERE is_active'),
    pool.query(`SELECT DISTINCT exercise_id FROM exercise_logs
                WHERE user_id=$1 AND completed_at > now() - interval '3 days'`, [userId]),
    // 같은 증상에서 이 사용자에게 실제로 효과(강도 감소)가 있었던 운동
    pool.query(`SELECT l.exercise_id, AVG(s.intensity_before - l.intensity_after)::float AS drop
                FROM exercise_logs l JOIN symptom_logs s USING (symptom_log_id)
                WHERE l.user_id=$1 AND s.symptom_type=$2 AND l.intensity_after IS NOT NULL
                GROUP BY l.exercise_id`, [userId, input.symptomType]),
  ]);

  const ctx = {
    symptomType: input.symptomType, cravingLevel: input.cravingLevel,
    fitnessLevel: profile.fitness_level, healthFlags: profile.health_flags,
    availableMinutes: input.availableMinutes, location: input.location, hasEquipment: input.hasEquipment,
    recentExerciseIds: new Set(recent.map((r) => Number(r.exercise_id))),
    effectiveness: new Map(eff.map((r) => [Number(r.exercise_id), r.drop])),
  };

  // 2) 후보 선별 → AI 선택 (실패 시 점수 1위)
  const candidates = rankCandidates(exercises, ctx, 5);
  if (!candidates.length) throw err(422, '조건에 맞는 운동이 없습니다. 가능 시간이나 장소 조건을 늘려 보세요.');

  const llm = await chooseWithLLM(candidates, ctx);
  const chosen = llm?.candidate ?? candidates[0];
  const source = llm ? 'LLM' : 'RULE';
  const reason = llm?.reason ?? `${chosen.why.join(', ') || '안전 조건을 만족하는 운동'} 기준으로 선택했습니다.`;

  // 3) 쓰기 단계: 증상 기록 + 추천 발급을 한 트랜잭션으로
  return tx(async (c) => {
    const { rows: [sym] } = await c.query(
      `INSERT INTO symptom_logs(user_id,symptom_type,intensity_before) VALUES($1,$2,$3) RETURNING symptom_log_id`,
      [userId, input.symptomType, input.cravingLevel]);
    const { rows: [rec] } = await c.query(
      `INSERT INTO ai_recommendations(user_id,exercise_id,symptom_log_id,craving_level,context,reason,source)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING recommendation_id, expires_at`,
      [userId, chosen.exercise.exercise_id, sym.symptom_log_id, input.cravingLevel,
       { ...input, fitnessLevel: ctx.fitnessLevel, candidates: candidates.map((x) => ({ id: Number(x.exercise.exercise_id), score: x.score })) },
       reason, source]);
    const e = chosen.exercise;
    return {
      recommendationId: rec.recommendation_id, expiresAt: rec.expires_at, source, reason,
      symptomLogId: sym.symptom_log_id,
      exercise: { exerciseId: Number(e.exercise_id), title: e.title, category: e.category,
        durationMinutes: e.duration_minutes, intensity: e.intensity, description: e.description,
        instructions: e.instructions, videoUrl: e.video_url },
      alternatives: candidates.filter((x) => x !== chosen).slice(0, 3)
        .map((x) => ({ exerciseId: Number(x.exercise.exercise_id), title: x.exercise.title })),
    };
  });
}
