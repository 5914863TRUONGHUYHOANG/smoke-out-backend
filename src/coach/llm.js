// Google Gemini Native REST API & OpenAI-compatible Fallback
export function llmConfigured() {
  return Boolean(process.env.GEMINI_API_KEY || (process.env.LLM_API_KEY && process.env.LLM_MODEL));
}

export async function chat({ messages }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    const model = process.env.LLM_MODEL || 'gemini-3.8-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let systemInstruction = null;
    const contents = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemInstruction = { parts: [{ text: m.content }] };
      } else if (m.role === 'user') {
        if (m.content) contents.push({ role: 'user', parts: [{ text: m.content }] });
      } else if (m.role === 'assistant') {
        if (m.content) contents.push({ role: 'model', parts: [{ text: m.content }] });
      }
    }

    if (!contents.length) {
      contents.push({ role: 'user', parts: [{ text: 'Xin chào' }] });
    }

    const payload = {
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      generationConfig: {
        temperature: 0.7,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error(`[Gemini Native LLM Error ${res.status}]:`, errorText);
      throw Object.assign(new Error(`LLM Error ${res.status}: ${errorText}`), { status: 502 });
    }

    const data = await res.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText) throw Object.assign(new Error('Empty Gemini response'), { status: 502 });

    return {
      role: 'assistant',
      content: replyText,
    };
  }

  // OpenAI-compatible fallback
  const res = await fetch(`${process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      temperature: 0.3,
      messages,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw Object.assign(new Error(`LLM ${res.status}`), { status: 502 });
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw Object.assign(new Error('empty LLM response'), { status: 502 });
  return msg;
}
