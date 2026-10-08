// 후보 선별: 안전 필터(하드) + 상태 기반 점수화(소프트). 순수 함수 → 테스트 가능
export const SYMPTOMS = ['CRAVING','ANXIETY','IRRITABILITY','STRESS','INSOMNIA','FATIGUE','RESTLESSNESS','COUGH'];
const LEVEL = { BEGINNER: 0, INTERMEDIATE: 1, ADVANCED: 2 };

/** 안전/적합성 하드 필터. 하나라도 걸리면 AI에게 아예 보이지 않는다 */
export function passesSafety(ex, ctx) {
  if (!ex.is_active) return false;
  if (LEVEL[ex.min_fitness_level] > LEVEL[ctx.fitnessLevel]) return false;
  if (ex.duration_minutes > ctx.availableMinutes) return false;
  if (ex.contraindications.some((f) => ctx.healthFlags.includes(f))) return false;
  if (ex.location !== 'ANY' && ctx.location !== 'ANY' && ex.location !== ctx.location) return false;
  if (ex.requires_equipment && !ctx.hasEquipment) return false;
  if (ctx.symptomType === 'INSOMNIA' && ex.intensity !== 'LOW') return false; // 수면 증상엔 저강도만
  return true;
}

function score(ex, ctx) {
  let s = 0; const why = [];
  const matches = ex.target_symptoms.includes(ctx.symptomType);
  if (matches) { s += 5; why.push('증상 일치'); }
  if (ctx.cravingLevel >= ex.craving_min && ctx.cravingLevel <= ex.craving_max) { s += 3; why.push('욕구 강도 적합'); }
  else s -= 2;
  if (ctx.cravingLevel >= 7 && ex.tags.includes('QUICK_RELIEF')) { s += 3; why.push('즉각 완화형'); }
  if (ctx.cravingLevel >= 7 && ex.duration_minutes <= 5) s += 1;
  if (ctx.cravingLevel <= 3 && ex.tags.includes('HABIT_BUILDING')) { s += 1; why.push('습관 형성'); }
  if (ctx.recentExerciseIds.has(Number(ex.exercise_id))) { s -= 2; why.push('최근 수행(다양성 감점)'); }
  const eff = ctx.effectiveness.get(Number(ex.exercise_id));
  if (eff != null) { s += Math.max(-3, Math.min(3, eff)); if (eff > 0) why.push('과거 효과 좋음'); }
  return { exercise: ex, score: s, matches, why };
}

/** 안전 필터 → 증상 일치 우선 → 점수순. 일치 후보가 없으면 안전한 운동 전체로 완화 */
export function rankCandidates(exercises, ctx, limit = 5) {
  const safe = exercises.filter((e) => passesSafety(e, ctx)).map((e) => score(e, ctx));
  const matched = safe.filter((x) => x.matches);
  const pool = matched.length ? matched : safe;
  return pool
    .sort((a, b) => b.score - a.score || Number(a.exercise.exercise_id) - Number(b.exercise.exercise_id))
    .slice(0, limit);
}

/** LLM 응답 검증: 후보 목록 안의 id가 아니면 null (환각 차단) */
export function pickValid(parsed, candidates) {
  const id = Number(parsed?.exerciseId);
  const hit = candidates.find((c) => Number(c.exercise.exercise_id) === id);
  if (!hit) return null;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : null;
  return { candidate: hit, reason };
}
