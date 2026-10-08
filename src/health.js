import { tx } from './db.js';
import { reverifyPending } from './exerciseLogs.js';

// 모든 프로바이더 데이터를 이 형태로 정규화해서 저장
export async function ingestRecords(userId, provider, records) {
  return tx(async (c) => {
    let inserted = 0;
    for (const r of records) {
      const res = await c.query(
        `INSERT INTO health_records(user_id,provider,external_id,activity_type,started_at,ended_at,avg_heart_rate,max_heart_rate,steps,calories,raw)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (provider,external_id) DO NOTHING`,
        [userId, provider, r.externalId, r.activityType ?? null, r.startedAt, r.endedAt,
         r.avgHeartRate ?? null, r.maxHeartRate ?? null, r.steps ?? null, r.calories ?? null, r.raw ?? null]);
      inserted += res.rowCount;
    }
    const reverified = await reverifyPending(c, userId);
    return { inserted, reverified };
  });
}
