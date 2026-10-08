import { pool } from './db.js';
import { ingestRecords } from './health.js';

// Fitbit Web API: activities/list (OAuth 토큰은 health_connections에 저장되어 있어야 함)
export async function syncFitbit(userId, afterDate) {
  const { rows: [conn] } = await pool.query(
    `SELECT access_token FROM health_connections WHERE user_id=$1 AND provider='FITBIT'`, [userId]);
  if (!conn) throw Object.assign(new Error('Fitbit 연결 정보가 없습니다'), { status: 400 });

  const url = `https://api.fitbit.com/1/user/-/activities/list.json?afterDate=${afterDate}&sort=asc&limit=50&offset=0`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${conn.access_token}` } });
  if (!res.ok) throw Object.assign(new Error(`Fitbit API ${res.status}`), { status: 502 });
  const { activities = [] } = await res.json();

  const records = activities.map((a) => ({
    externalId: String(a.logId),
    activityType: a.activityName,
    startedAt: new Date(a.startTime).toISOString(),
    endedAt: new Date(new Date(a.startTime).getTime() + a.duration).toISOString(),
    avgHeartRate: a.averageHeartRate, steps: a.steps, calories: a.calories, raw: a,
  }));
  return ingestRecords(userId, 'FITBIT', records);
}
