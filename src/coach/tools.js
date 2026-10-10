import { z } from 'zod';
import { SYMPTOMS, passesSafety, rankCandidates } from '../reco/ranking.js';
import { buildContext } from '../reco/context.js';
import { smokeFreeDays, nextMilestone } from '../points/policy.js';
import { streakStartOf, pointSummary } from '../points/service.js';

/**
 * Read-only tools + ONE guarded write (recommend_exercise).
 * Security rules:
 *  - No tool accepts a user id. The server binds userId from the authenticated session.
 *  - Every argument is validated with a strict schema (unknown keys rejected).
 *  - Safety filters (contraindications, level, time...) are enforced here, not by the model.
 */
const sym = z.enum(SYMPTOMS);
const loc = z.enum(['ANY', 'INDOOR', 'OUTDOOR']);

const brief = (e) => ({ exerciseId: Number(e.exercise_id), title: e.title, category: e.category,
  minutes: e.duration_minutes, intensity: e.intensity, description: e.description });

export const TOOL_DEFS = [
  { name: 'search_exercises',
    description: 'Search the exercise catalog for exercises that are SAFE for this user right now. Returns up to 5 ranked candidates.',
    parameters: { type: 'object', additionalProperties: false, required: ['symptomType'], properties: {
      symptomType: { type: 'string', enum: SYMPTOMS }, cravingLevel: { type: 'integer', minimum: 0, maximum: 10 },
      maxMinutes: { type: 'integer', minimum: 1, maximum: 120 }, location: { type: 'string', enum: ['ANY', 'INDOOR', 'OUTDOOR'] } } } },
  { name: 'get_exercise_details',
    description: 'Get full instructions for one exercise from the catalog.',
    parameters: { type: 'object', additionalProperties: false, required: ['exerciseId'], properties: { exerciseId: { type: 'integer' } } } },
  { name: 'get_my_recent_logs',
    description: "The current user's recent exercise, symptom and smoking logs.",
    parameters: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: 14 } } } },
  { name: 'get_my_status',
    description: "The current user's smoke-free days, next point milestone, and today's remaining AI-exercise points.",
    parameters: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'recommend_exercise',
    description: 'Officially recommend ONE exercise to the user (needed so completing it can earn points). Only exercises that pass the safety filter are accepted. Call at most once.',
    parameters: { type: 'object', additionalProperties: false, required: ['exerciseId', 'symptomType', 'cravingLevel', 'reason'], properties: {
      exerciseId: { type: 'integer' }, symptomType: { type: 'string', enum: SYMPTOMS },
      cravingLevel: { type: 'integer', minimum: 0, maximum: 10 }, availableMinutes: { type: 'integer', minimum: 1, maximum: 120 },
      location: { type: 'string', enum: ['ANY', 'INDOOR', 'OUTDOOR'] }, reason: { type: 'string', maxLength: 300 } } } },
];

const schemas = {
  search_exercises: z.object({ symptomType: sym, cravingLevel: z.number().int().min(0).max(10).default(5),
    maxMinutes: z.number().int().min(1).max(120).default(15), location: loc.default('ANY') }).strict(),
  get_exercise_details: z.object({ exerciseId: z.number().int().positive() }).strict(),
  get_my_recent_logs: z.object({ days: z.number().int().min(1).max(14).default(7) }).strict(),
  get_my_status: z.object({}).strict(),
  recommend_exercise: z.object({ exerciseId: z.number().int().positive(), symptomType: sym,
    cravingLevel: z.number().int().min(0).max(10), availableMinutes: z.number().int().min(1).max(120).default(15),
    location: loc.default('ANY'), reason: z.string().min(1).max(300) }).strict(),
};

/** deps = { db: {query, tx}, userId, state } ; state.recommendation is set by recommend_exercise */
const runners = {
  async search_exercises({ db, userId }, a) {
    const { exercises, ctx } = await buildContext(db, userId, { ...a, availableMinutes: a.maxMinutes, location: a.location });
    const c = rankCandidates(exercises, ctx, 5);
    return c.length ? { candidates: c.map((x) => ({ ...brief(x.exercise), score: x.score, why: x.why })) }
                     : { candidates: [], note: 'No safe exercise matches. Try more minutes or any location.' };
  },
  async get_exercise_details({ db }, a) {
    const { rows: [e] } = await db.query('SELECT * FROM exercises WHERE exercise_id=$1 AND is_active', [a.exerciseId]);
    return e ? { ...brief(e), instructions: e.instructions } : { error: 'exercise not found' };
  },
  async get_my_recent_logs({ db, userId }, a) {
    const [ex, sy, sm] = await Promise.all([
      db.query(`SELECT e.title, l.completed_at, l.duration_completed, l.verification_status, l.intensity_after
                FROM exercise_logs l JOIN exercises e USING(exercise_id)
                WHERE l.user_id=$1 AND l.completed_at > now() - make_interval(days => $2)
                ORDER BY l.completed_at DESC LIMIT 20`, [userId, a.days]),
      db.query(`SELECT symptom_type, intensity_before, logged_at FROM symptom_logs
                WHERE user_id=$1 AND logged_at > now() - make_interval(days => $2) ORDER BY logged_at DESC LIMIT 20`, [userId, a.days]),
      db.query(`SELECT cigarettes_smoked, trigger_cause, logged_at FROM smoke_logs
                WHERE user_id=$1 AND logged_at > now() - make_interval(days => $2) ORDER BY logged_at DESC LIMIT 20`, [userId, a.days]),
    ]);
    return { exercises: ex.rows, symptoms: sy.rows, smoking: sm.rows };
  },
  async get_my_status({ db, userId }) {
    const days = smokeFreeDays(await streakStartOf(db, userId), new Date());
    const p = await pointSummary(userId);
    return { smokeFreeDays: days, nextMilestone: nextMilestone(days), points: p };
  },
  async recommend_exercise({ db, userId, state }, a) {
    if (state.recommendation) return { error: 'a recommendation was already issued in this turn' };
    const { rows: [e] } = await db.query('SELECT * FROM exercises WHERE exercise_id=$1', [a.exerciseId]);
    if (!e) return { error: 'exercise not found' };
    const { ctx } = await buildContext(db, userId, { ...a, availableMinutes: a.availableMinutes });
    if (!passesSafety(e, ctx)) return { error: 'This exercise is not safe or suitable for this user. Use search_exercises and pick from its results.' };
    const rec = await db.tx(async (c) => {
      const { rows: [s] } = await c.query(
        'INSERT INTO symptom_logs(user_id,symptom_type,intensity_before) VALUES($1,$2,$3) RETURNING symptom_log_id',
        [userId, a.symptomType, a.cravingLevel]);
      const { rows: [r] } = await c.query(
        `INSERT INTO ai_recommendations(user_id,exercise_id,symptom_log_id,craving_level,context,reason,source)
         VALUES($1,$2,$3,$4,$5,$6,'LLM') RETURNING recommendation_id, expires_at`,
        [userId, a.exerciseId, s.symptom_log_id, a.cravingLevel, { via: 'coach', ...a }, a.reason]);
      return r;
    });
    state.recommendation = { recommendationId: rec.recommendation_id, expiresAt: rec.expires_at, ...brief(e), instructions: e.instructions };
    return { ok: true, recommendationId: rec.recommendation_id };
  },
};

/** Never throws: errors go back to the model so it can recover. Internals are not leaked. */
export async function executeTool(name, rawArgs, deps) {
  const run = runners[name];
  if (!run) return { error: `unknown tool: ${name}` };
  let args;
  try { args = JSON.parse(rawArgs || '{}'); } catch { return { error: 'arguments must be valid JSON' }; }
  const parsed = schemas[name].safeParse(args);
  if (!parsed.success) return { error: 'invalid arguments', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  try { return await run(deps, parsed.data); }
  catch (e) { console.error('tool failed', name, e); return { error: 'tool failed' }; }
}
