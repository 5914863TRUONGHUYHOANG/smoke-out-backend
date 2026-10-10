import express from 'express';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { createExerciseLog } from './exerciseLogs.js';
import { ingestRecords } from './health.js';
import { syncFitbit } from './fitbit.js';
import { recommend } from './reco/service.js';
import { SYMPTOMS } from './reco/ranking.js';
import { coachChat, coachHistory } from './coach/service.js';
import { claimMilestones, pointSummary } from './points/service.js';
import { startNotificationScheduler } from './notifications.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api', async (req, res, next) => {
  const id = req.header('x-user-id')?.trim();
  if (!/^[1-9]\d*$/.test(id ?? '')) {
    return res.status(401).json({ error: 'x-user-id header required' });
  }
  req.userId = id;
  try {
    await pool.query('UPDATE users SET last_access_at = NOW() WHERE user_id::text = $1', [id]);
    next();
  } catch (error) {
    next(error);
  }
});

const dt = z.string().datetime({ offset: true });
const logSchema = z.object({
  exerciseId: z.number().int().positive(),
  symptomLogId: z.number().int().positive().optional(),
  recommendationId: z.number().int().positive().optional(),
  startedAt: dt,
  completedAt: dt,
  durationCompleted: z.number().int().min(1).max(600),
  intensityAfter: z.number().int().min(0).max(10).optional(),
});
const recordSchema = z.object({
  provider: z.enum(['APPLE_HEALTH', 'HEALTH_CONNECT', 'FITBIT', 'MANUAL']),
  records: z.array(z.object({
    externalId: z.string().min(1),
    activityType: z.string().optional(),
    startedAt: dt,
    endedAt: dt,
    avgHeartRate: z.number().int().optional(),
    maxHeartRate: z.number().int().optional(),
    steps: z.number().int().optional(),
    calories: z.number().int().optional(),
  })).min(1).max(200),
});
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/exercises', wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM exercises WHERE is_active ORDER BY exercise_id');
  res.json(rows);
}));

app.get('/api/rankings', wrap(async (req, res) => {
  const { limit } = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query);
  const { rows } = await pool.query(
    `WITH totals AS (
       SELECT u.user_id, u.nickname,
              COALESCE(r.total_points, 0)::integer AS total_points
       FROM users u
       LEFT JOIN user_ranks r ON r.user_id = u.user_id
     ),
     ranked AS (
       SELECT RANK() OVER (ORDER BY total_points DESC) AS rank,
              user_id, nickname, total_points
       FROM totals
     )
     SELECT rank, user_id, nickname, total_points
     FROM ranked
     ORDER BY rank, nickname
     LIMIT $1`,
    [limit]);
  res.json(rows);
}));

app.post('/api/symptom-logs', wrap(async (req, res) => {
  const body = z.object({
    symptomType: z.enum(SYMPTOMS),
    intensityBefore: z.number().int().min(0).max(10),
  }).parse(req.body);
  const { rows: [log] } = await pool.query(
    `INSERT INTO symptom_logs (user_id, symptom_type, intensity_before)
     VALUES ($1, $2, $3) RETURNING symptom_log_id`,
    [req.userId, body.symptomType, body.intensityBefore]);
  res.status(201).json({ symptomLogId: log.symptom_log_id });
}));

app.post('/api/smoke-logs', wrap(async (req, res) => {
  const body = z.object({
    cigarettesSmoked: z.number().int().positive(),
    triggerCause: z.string().max(100).optional(),
  }).parse(req.body);
  const { rows: [log] } = await pool.query(
    `INSERT INTO smoke_logs(user_id,cigarettes_smoked,trigger_cause)
     VALUES($1,$2,$3) RETURNING smoke_log_id`,
    [req.userId, body.cigarettesSmoked, body.triggerCause ?? null]);
  res.status(201).json({ smokeLogId: log.smoke_log_id });
}));

app.post('/api/recommendations', wrap(async (req, res) => {
  const body = z.object({
    symptomType: z.enum(SYMPTOMS),
    cravingLevel: z.number().int().min(0).max(10),
    availableMinutes: z.number().int().min(1).max(120).default(15),
    location: z.enum(['ANY', 'INDOOR', 'OUTDOOR']).default('ANY'),
    hasEquipment: z.boolean().default(false),
  }).parse(req.body);
  res.status(201).json(await recommend(req.userId, body));
}));

app.put('/api/profile/health', wrap(async (req, res) => {
  const body = z.object({
    fitnessLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
    healthFlags: z.array(z.enum([
      'HEART_CONDITION', 'HYPERTENSION', 'ASTHMA', 'PREGNANCY', 'JOINT_PAIN', 'BACK_PAIN',
    ])).default([]),
  }).parse(req.body);
  const result = await pool.query(
    'UPDATE user_profiles SET fitness_level=$2, health_flags=$3 WHERE user_id=$1',
    [req.userId, body.fitnessLevel, body.healthFlags]);
  if (!result.rowCount) return res.status(404).json({ error: 'profile not found' });
  res.status(204).end();
}));

app.post('/api/coach', wrap(async (req, res) => {
  const { message } = z.object({
    message: z.string().trim().min(1).max(500),
  }).parse(req.body);
  res.json(await coachChat(req.userId, message));
}));
app.get('/api/coach/history', wrap(async (req, res) => {
  res.json(await coachHistory(req.userId));
}));

app.post('/api/points/claim-milestones', wrap(async (req, res) => {
  res.json(await claimMilestones(req.userId));
}));
app.get('/api/points/summary', wrap(async (req, res) => {
  res.json(await pointSummary(req.userId));
}));

app.post('/api/exercise-logs', wrap(async (req, res) => {
  const body = logSchema.parse(req.body);
  res.status(201).json(await createExerciseLog(req.userId, body));
}));
app.get('/api/exercise-logs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM exercise_logs WHERE user_id=$1 ORDER BY completed_at DESC LIMIT 100',
    [req.userId]);
  res.json(rows);
}));

app.post('/api/health/records', wrap(async (req, res) => {
  const { provider, records } = recordSchema.parse(req.body);
  res.json(await ingestRecords(req.userId, provider, records));
}));
app.put('/api/health/connections/fitbit', wrap(async (req, res) => {
  const { accessToken, refreshToken } = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
  }).parse(req.body);
  await pool.query(
    `INSERT INTO health_connections(user_id,provider,access_token,refresh_token)
     VALUES($1,'FITBIT',$2,$3)
     ON CONFLICT (user_id,provider) DO UPDATE SET access_token=$2, refresh_token=$3`,
    [req.userId, accessToken, refreshToken ?? null]);
  res.status(204).end();
}));
app.post('/api/health/fitbit/sync', wrap(async (req, res) => {
  const { afterDate } = z.object({
    afterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(req.body);
  res.json(await syncFitbit(req.userId, afterDate));
}));

app.put('/api/notifications/fcm-token', wrap(async (req, res) => {
  const { fcmToken } = z.object({
    fcmToken: z.string().min(1).max(4096),
  }).parse(req.body);
  await pool.query(
    `INSERT INTO fcm_device_tokens (fcm_token, user_id)
     VALUES ($1, $2)
     ON CONFLICT (fcm_token) DO UPDATE
       SET user_id = EXCLUDED.user_id, updated_at = NOW()`,
    [fcmToken, req.userId]);
  res.status(204).end();
}));
app.delete('/api/notifications/fcm-token', wrap(async (req, res) => {
  const { fcmToken } = z.object({
    fcmToken: z.string().min(1).max(4096),
  }).parse(req.body);
  await pool.query(
    'DELETE FROM fcm_device_tokens WHERE fcm_token = $1 AND user_id = $2',
    [fcmToken, req.userId]);
  res.status(204).end();
}));

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'validation', details: error.issues });
  }
  if (error.code === '23505') return res.status(409).json({ error: 'duplicate' });
  if (error.code === '23503') return res.status(404).json({ error: 'referenced row not found' });
  console.error(error);
  res.status(error.status ?? 500).json({ error: error.message });
});

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`API on :${process.env.PORT ?? 3000}`);
  startNotificationScheduler();
});
