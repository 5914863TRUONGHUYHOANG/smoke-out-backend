import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, TOOL_DEFS } from '../src/coach/tools.js';
import { coachChat, LIMITS } from '../src/coach/service.js';

const EX = (id, o = {}) => ({ exercise_id: id, title: `ex${id}`, category: 'BREATHING', is_active: true, duration_minutes: 5, intensity: 'LOW',
  description: 'd', instructions: 'i', target_symptoms: ['CRAVING'], min_fitness_level: 'BEGINNER', location: 'ANY',
  requires_equipment: false, contraindications: [], craving_min: 0, craving_max: 10, tags: ['QUICK_RELIEF'], ...o });

function fakeDb({ flags = [], exercises = [EX(1)], messages = [], todayUserMsgs = 0 } = {}) {
  const log = [];
  const run = async (sql, params) => {
    log.push({ sql, params });
    if (sql.includes('user_profiles')) return { rows: [{ fitness_level: 'BEGINNER', health_flags: flags }] };
    if (sql.includes('DISTINCT exercise_id')) return { rows: [] };
    if (sql.includes('AVG(')) return { rows: [] };
    if (sql.includes('FROM exercises WHERE exercise_id')) return { rows: exercises.filter((e) => e.exercise_id === params[0]) };
    if (sql.includes('FROM exercises WHERE is_active')) return { rows: exercises };
    if (sql.includes('COUNT(*)')) return { rows: [{ n: todayUserMsgs }] };
    if (sql.includes('FROM coach_messages')) return { rows: messages };
    if (sql.includes('INSERT INTO symptom_logs')) return { rows: [{ symptom_log_id: 7 }] };
    if (sql.includes('INSERT INTO ai_recommendations')) return { rows: [{ recommendation_id: 99, expires_at: 'x' }] };
    return { rows: [] };
  };
  return { query: run, tx: (fn) => fn({ query: run }), log };
}

test('no tool accepts a user id', () => {
  for (const t of TOOL_DEFS) assert.equal('userId' in (t.parameters.properties ?? {}), false, t.name);
});
test('strict schema rejects an injected userId', async () => {
  const r = await executeTool('get_my_recent_logs', JSON.stringify({ userId: 2 }), { db: fakeDb(), userId: 1, state: {} });
  assert.equal(r.error, 'invalid arguments');
});
test('invalid JSON, unknown tool, bad enum are returned as errors, not thrown', async () => {
  const d = { db: fakeDb(), userId: 1, state: {} };
  assert.match((await executeTool('search_exercises', '{oops', d)).error, /JSON/);
  assert.match((await executeTool('drop_table', '{}', d)).error, /unknown/);
  assert.equal((await executeTool('search_exercises', JSON.stringify({ symptomType: 'HUNGER' }), d)).error, 'invalid arguments');
});
test('search_exercises hides exercises that are unsafe for the user', async () => {
  const db = fakeDb({ flags: ['HEART_CONDITION'], exercises: [EX(1, { contraindications: ['HEART_CONDITION'] }), EX(2)] });
  const r = await executeTool('search_exercises', JSON.stringify({ symptomType: 'CRAVING' }), { db, userId: 1, state: {} });
  assert.deepEqual(r.candidates.map((c) => c.exerciseId), [2]);
});
test('recommend_exercise refuses an unsafe exercise even if the model insists', async () => {
  const db = fakeDb({ flags: ['HEART_CONDITION'], exercises: [EX(1, { contraindications: ['HEART_CONDITION'] })] });
  const state = {};
  const r = await executeTool('recommend_exercise', JSON.stringify({ exerciseId: 1, symptomType: 'CRAVING', cravingLevel: 8, reason: 'x' }), { db, userId: 1, state });
  assert.match(r.error, /not safe/);
  assert.equal(state.recommendation, undefined);
  assert.equal(db.log.some((l) => l.sql.includes('INSERT INTO ai_recommendations')), false);
});
test('recommend_exercise binds the server userId and works only once per turn', async () => {
  const db = fakeDb(); const state = {};
  const a = JSON.stringify({ exerciseId: 1, symptomType: 'CRAVING', cravingLevel: 8, reason: 'quick relief' });
  assert.equal((await executeTool('recommend_exercise', a, { db, userId: 42, state })).ok, true);
  assert.equal(db.log.find((l) => l.sql.includes('INSERT INTO symptom_logs')).params[0], 42);
  assert.match((await executeTool('recommend_exercise', a, { db, userId: 42, state })).error, /already/);
});

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const deps = (db, script) => { let i = 0; const seen = []; return { db, configured: () => true, seen,
  chat: async ({ messages }) => { seen.push(messages.length); return script[i++]; } }; };

test('full loop: model searches, recommends, then answers', async () => {
  const db = fakeDb();
  const d = deps(db, [
    { tool_calls: [call('a', 'search_exercises', { symptomType: 'CRAVING', cravingLevel: 8 })] },
    { tool_calls: [call('b', 'recommend_exercise', { exerciseId: 1, symptomType: 'CRAVING', cravingLevel: 8, reason: 'fast' })] },
    { content: 'Try ex1 for 5 minutes.' },
  ]);
  const r = await coachChat(1, 'craving!', d);
  assert.equal(r.reply, 'Try ex1 for 5 minutes.');
  assert.deepEqual(r.toolsUsed, ['search_exercises', 'recommend_exercise']);
  assert.equal(r.recommendation.recommendationId, 99);
  assert.equal(db.log.filter((l) => l.sql.includes('INSERT INTO coach_messages')).length, 2);
});
test('loop is bounded when the model keeps calling tools', async () => {
  const forever = Array.from({ length: 20 }, (_, i) => ({ tool_calls: [call(`c${i}`, 'get_exercise_details', { exerciseId: 1 })] }));
  const d = deps(fakeDb(), forever);
  const r = await coachChat(1, 'hi', d);
  assert.equal(d.seen.length, LIMITS.maxRounds);
  assert.match(r.reply, /could not finish/);
});
test('daily limit and missing config', async () => {
  await assert.rejects(coachChat(1, 'hi', deps(fakeDb({ todayUserMsgs: LIMITS.dailyUserMessages }), [])), { status: 429 });
  await assert.rejects(coachChat(1, 'hi', { ...deps(fakeDb(), []), configured: () => false }), { status: 503 });
});
