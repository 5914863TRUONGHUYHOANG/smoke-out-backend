import express from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { createExerciseLog } from './exerciseLogs.js';
import { ingestRecords } from './health.js';
import { syncFitbit } from './fitbit.js';
import { claimMilestones, pointSummary } from './points/service.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// 개발용 인증: x-user-id 헤더. 운영에서는 JWT 등으로 교체하세요.
app.use('/api', (req, res, next) => {
  const id = Number(req.header('x-user-id'));
  if (!Number.isInteger(id) || id <= 0) return res.status(401).json({ error: 'x-user-id header required' });
  req.userId = id;
  next();
});

const dt = z.string().datetime({ offset: true });
const logSchema = z.object({
  exerciseId: z.number().int().positive(),
  symptomLogId: z.number().int().positive().optional(),
  recommendationId: z.number().int().positive().optional(),
  startedAt: dt, completedAt: dt,
  durationCompleted: z.number().int().min(1).max(600),
  intensityAfter: z.number().int().min(0).max(10).optional(),
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

app.post('/api/health/fitbit/sync', wrap(async (req, res) => {
  const { afterDate } = z.object({ afterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  res.json(await syncFitbit(req.userId, afterDate));
}));

// --- 흡연 기록 (스트릭 리셋) ---
app.post('/api/smoke-logs', wrap(async (req, res) => {
  const b = z.object({ cigarettesSmoked: z.number().int().positive(), triggerCause: z.string().max(100).optional() }).parse(req.body);
  await pool.query('INSERT INTO smoke_logs(user_id,cigarettes_smoked,trigger_cause) VALUES($1,$2,$3)', [req.userId, b.cigarettesSmoked, b.triggerCause ?? null]);
  res.status(201).json({ ok: true });
}));

// --- AI 추천 발급 (개발용 스텁: 실제로는 AI 서비스가 서버 내부에서 호출) ---
app.post('/api/recommendations', wrap(async (req, res) => {
  const { exerciseId } = z.object({ exerciseId: z.number().int().positive() }).parse(req.body);
  const { rows: [r] } = await pool.query(
    'INSERT INTO ai_recommendations(user_id,exercise_id) VALUES($1,$2) RETURNING *', [req.userId, exerciseId]);
  res.status(201).json(r);
}));

// --- 포인트 ---
app.post('/api/points/claim-milestones', wrap(async (req, res) => res.json(await claimMilestones(req.userId))));
app.get('/api/points/summary', wrap(async (req, res) => res.json(await pointSummary(req.userId))));

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'validation', details: err.issues });
  if (err.code === '23505') return res.status(409).json({ error: 'duplicate' });
  if (err.code === '23503') return res.status(404).json({ error: 'referenced row not found' });
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

app.listen(process.env.PORT ?? 3000, () => console.log(`API on :${process.env.PORT ?? 3000}`));
