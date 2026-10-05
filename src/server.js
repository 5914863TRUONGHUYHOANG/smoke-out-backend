import express from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { createExerciseLog } from './exerciseLogs.js';
import { ingestRecords } from './health.js';
import { syncFitbit } from './fitbit.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

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
  startedAt: dt, completedAt: dt,
  durationCompleted: z.number().int().min(1).max(600),
  intensityAfter: z.number().int().min(0).max(10).optional(),
});

const symptomLogSchema = z.object({
  symptomType: z.string().min(1),
  intensityBefore: z.number().int().min(0).max(10),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional(),
});

const smokeLogSchema = z.object({
  cigarettesSmoked: z.number().int().positive(),
  triggerCause: z.string().optional(),
});

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/health', (_q, r) => r.json({ ok: true }));

app.get('/api/exercises', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM exercises ORDER BY exercise_id');
  res.json(rows);
}));

app.post('/api/symptom-logs', wrap(async (req, res) => {
  const body = symptomLogSchema.parse(req.body);
  const status = body.status ?? 'PENDING';
  const { rows } = await pool.query(
    `INSERT INTO symptom_logs (user_id, symptom_type, intensity_before, status)
     VALUES ($1, $2, $3, $4) RETURNING symptom_log_id, status`,
    [req.userId, body.symptomType, body.intensityBefore, status]
  );
  res.status(201).json({ symptomLogId: rows[0].symptom_log_id, status: rows[0].status });
}));

app.post('/api/smoke-logs', wrap(async (req, res) => {
  const body = smokeLogSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO smoke_logs (user_id, cigarettes_smoked, trigger_cause)
     VALUES ($1, $2, $3) RETURNING smoke_log_id`,
    [req.userId, body.cigarettesSmoked, body.triggerCause ?? null]
  );
  res.status(201).json({ smokeLogId: rows[0].smoke_log_id });
}));

app.post('/api/exercise-logs', wrap(async (req, res) => {
  const body = logSchema.parse(req.body);
  res.status(201).json(await createExerciseLog(req.userId, body));
}));

app.get('/api/exercise-logs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM exercise_logs WHERE user_id=$1 ORDER BY completed_at DESC LIMIT 100', [req.userId]);
  res.json(rows);
}));

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'validation', details: err.issues });
  if (err.code === '23503') return res.status(404).json({ error: 'referenced row not found' });
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

app.listen(process.env.PORT ?? 3000, () => console.log(`API on :${process.env.PORT ?? 3000}`));
