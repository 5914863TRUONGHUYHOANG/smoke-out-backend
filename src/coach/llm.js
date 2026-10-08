// OpenAI-compatible Chat Completions with tool calling. Returns the assistant message.
export function llmConfigured() { return Boolean(process.env.LLM_API_KEY && process.env.LLM_MODEL); }

export async function chat({ messages, tools }) {
  const res = await fetch(`${process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({ model: process.env.LLM_MODEL, temperature: 0.3, messages,
      ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw Object.assign(new Error(`LLM ${res.status}`), { status: 502 });
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw Object.assign(new Error('empty LLM response'), { status: 502 });
  return msg;
}
