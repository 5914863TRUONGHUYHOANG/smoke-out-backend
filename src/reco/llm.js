import { pickValid } from './ranking.js';

// OpenAI 호환 Chat Completions API. 키가 없거나 실패하면 null → 호출자가 규칙 기반으로 폴백
export async function chooseWithLLM(candidates, ctx) {
  const { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
  if (!LLM_API_KEY || !LLM_MODEL) return null;

  // 자유 텍스트는 넣지 않는다(프롬프트 인젝션 차단). 구조화된 값과 DB의 운동 정보만 전달
  const list = candidates.map((c) => ({
    exerciseId: Number(c.exercise.exercise_id), title: c.exercise.title,
    minutes: c.exercise.duration_minutes, intensity: c.exercise.intensity,
    description: c.exercise.description, score: c.score,
  }));
  const system = '너는 금연 보조 앱의 운동 추천기다. 반드시 주어진 후보 목록 중 정확히 하나만 고른다. ' +
    '목록에 없는 운동은 절대 만들지 않는다. JSON만 출력: {"exerciseId": number, "reason": "한국어 한두 문장"}';
  const user = JSON.stringify({
    state: { symptom: ctx.symptomType, cravingLevel0to10: ctx.cravingLevel, fitnessLevel: ctx.fitnessLevel,
             availableMinutes: ctx.availableMinutes, location: ctx.location },
    candidates: list });

  try {
    const res = await fetch(`${LLM_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({ model: LLM_MODEL, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return pickValid(JSON.parse(data.choices?.[0]?.message?.content ?? '{}'), candidates);
  } catch {
    return null;
  }
}
