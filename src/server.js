import express from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { createExerciseLog } from './exerciseLogs.js';
import { ingestRecords } from './health.js';
import { syncFitbit } from './fitbit.js';
import { startNotificationScheduler } from './notifications.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// 개발용 인증: x-user-id 헤더. 운영에서는 JWT 등으로 교체하세요.
app.use('/api', async (req, res, next) => {
  const id = req.header('x-user-id')?.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '');
  const isPositiveInteger = /^[1-9]\d*$/.test(id ?? '');
  if (!isUuid && !isPositiveInteger) return res.status(401).json({ error: 'x-user-id header required' });
  const userId = isUuid ? id.toLowerCase() : id;
  req.userId = userId;
  try {
    await pool.query('UPDATE users SET last_access_at = NOW() WHERE user_id::text = $1', [userId]);
    next();
  } catch (err) {
    next(err);
  }
});

const dt = z.string().datetime({ offset: true });

const logSchema = z.object({
  exerciseId: z.number().int().positive(),
  symptomLogId: z.number().int().positive().optional(),
  startedAt: dt, completedAt: dt,
  durationCompleted: z.number().int().min(1).max(600),
  intensityAfter: z.number().int().min(0).max(10).optional(),
});

const symptomLogSchema = z.object({
  symptomType: z.string().min(1),
  intensityBefore: z.number().int().min(0).max(10),
});

const smokeLogSchema = z.object({
  cigarettesSmoked: z.number().int().positive(),
  triggerCause: z.string().optional(),
});

const recordSchema = z.object({
  provider: z.enum(['APPLE_HEALTH', 'HEALTH_CONNECT', 'FITBIT', 'MANUAL']),
  records: z.array(z.object({
    externalId: z.string().min(1), activityType: z.string().optional(),
    startedAt: dt, endedAt: dt,
    avgHeartRate: z.number().int().optional(), maxHeartRate: z.number().int().optional(),
    steps: z.number().int().optional(), calories: z.number().int().optional(),
  })).min(1).max(200),
});

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/health', (_q, r) => r.json({ ok: true }));

app.get('/api/exercises', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM exercises ORDER BY exercise_id');
  res.json(rows);
}));

// Symptom Log POST
app.post('/api/symptom-logs', wrap(async (req, res) => {
  const body = symptomLogSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO symptom_logs (user_id, symptom_type, intensity_before)
     VALUES ($1, $2, $3) RETURNING symptom_log_id`,
    [req.userId, body.symptomType, body.intensityBefore]
  );
  res.status(201).json({ symptomLogId: rows[0].symptom_log_id });
}));

// Smoke Log POST
app.post('/api/smoke-logs', wrap(async (req, res) => {
  const body = smokeLogSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO smoke_logs (user_id, cigarettes_smoked, trigger_cause)
     VALUES ($1, $2, $3) RETURNING smoke_log_id`,
    [req.userId, body.cigarettesSmoked, body.triggerCause ?? null]
  );
  res.status(201).json({ smokeLogId: rows[0].smoke_log_id });
}));

// 운동 완료 제출 → 검증
app.post('/api/exercise-logs', wrap(async (req, res) => {
  const body = logSchema.parse(req.body);
  res.status(201).json(await createExerciseLog(req.userId, body));
}));

app.get('/api/exercise-logs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM exercise_logs WHERE user_id=$1 ORDER BY completed_at DESC LIMIT 100', [req.userId]);
  res.json(rows);
}));

// 앱(HealthKit / Health Connect)에서 읽은 데이터를 업로드
app.post('/api/health/records', wrap(async (req, res) => {
  const { provider, records } = recordSchema.parse(req.body);
  res.json(await ingestRecords(req.userId, provider, records));
}));

// Fitbit 토큰 저장 (OAuth 인증은 별도 수행)
app.put('/api/health/connections/fitbit', wrap(async (req, res) => {
  const { accessToken, refreshToken } = z.object({ accessToken: z.string(), refreshToken: z.string().optional() }).parse(req.body);
  await pool.query(
    `INSERT INTO health_connections(user_id,provider,access_token,refresh_token) VALUES($1,'FITBIT',$2,$3)
     ON CONFLICT (user_id,provider) DO UPDATE SET access_token=$2, refresh_token=$3`,
    [req.userId, accessToken, refreshToken ?? null]);
  res.status(204).end();
}));

app.put('/api/notifications/fcm-token', wrap(async (req, res) => {
  const { fcmToken } = z.object({ fcmToken: z.string().min(1).max(4096) }).parse(req.body);
  await pool.query(
    `INSERT INTO fcm_device_tokens (fcm_token, user_id)
     VALUES ($1, $2)
     ON CONFLICT (fcm_token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()`,
    [fcmToken, req.userId]
  );
  res.status(204).end();
}));

app.delete('/api/notifications/fcm-token', wrap(async (req, res) => {
  const { fcmToken } = z.object({ fcmToken: z.string().min(1).max(4096) }).parse(req.body);
  await pool.query('DELETE FROM fcm_device_tokens WHERE fcm_token = $1 AND user_id = $2', [fcmToken, req.userId]);
  res.status(204).end();
}));

app.post('/api/health/fitbit/sync', wrap(async (req, res) => {
  const { afterDate } = z.object({ afterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  res.json(await syncFitbit(req.userId, afterDate));
}));

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'validation', details: err.issues });
  if (err.code === '23503') return res.status(404).json({ error: 'referenced row not found' });
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`API on :${process.env.PORT ?? 3000}`);
  startNotificationScheduler();
});
