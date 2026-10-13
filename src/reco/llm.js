import { pickValid } from './ranking.js';

// Google Gemini / OpenAI 호환 Chat Completions API
export async function chooseWithLLM(candidates, ctx) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) return null;

  const isGemini = Boolean(process.env.GEMINI_API_KEY) || (process.env.LLM_MODEL?.toLowerCase().includes('gemini'));
  const baseUrl = process.env.LLM_BASE_URL || (isGemini
    ? 'https://generativelanguage.googleapis.com/v1beta/openai'
    : 'https://api.openai.com/v1');
  const model = process.env.LLM_MODEL || 'gemini-1.5-flash';

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
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[Gemini Reco LLM Error]:', err);
      return null;
    }
    const data = await res.json();
    return pickValid(JSON.parse(data.choices?.[0]?.message?.content ?? '{}'), candidates);
  } catch (err) {
    console.error('[Gemini Reco LLM Exception]:', err);
    return null;
  }
}
