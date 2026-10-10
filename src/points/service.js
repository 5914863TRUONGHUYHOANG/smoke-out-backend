import { tx } from '../db.js';
import { POLICY, kstDate, smokeFreeDays, milestonesUpTo, nextMilestone, grantWithCap } from './policy.js';

/** 사용자 단위 직렬화 락. 동시 요청이 와도 일일 한도 검사가 경쟁 상태가 되지 않는다 */
export async function lockUser(c, userId) {
  await c.query('INSERT INTO user_ranks(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
  await c.query('SELECT 1 FROM user_ranks WHERE user_id=$1 FOR UPDATE', [userId]);
}

/** 포인트 원장 기록 + 랭킹 집계 갱신. idempotency_key 충돌이면 아무 일도 하지 않고 false */
export async function applyPoints(c, { userId, type, points, refId = null, key, earnedOn }) {
  if (points <= 0) return false;
  const { rowCount } = await c.query(
    `INSERT INTO point_logs(user_id,point_type,points,reference_id,idempotency_key,earned_on)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [userId, type, points, refId, key, earnedOn]);
  if (!rowCount) return false;
  await c.query(
    `UPDATE user_ranks SET total_points=total_points+$2, weekly_points=weekly_points+$2,
       monthly_points=monthly_points+$2, updated_at=now() WHERE user_id=$1`, [userId, points]);
  return true;
}

async function earnedToday(c, userId, type, earnedOn) {
  const { rows: [r] } = await c.query(
    `SELECT COALESCE(SUM(points),0)::int AS s FROM point_logs WHERE user_id=$1 AND point_type=$2 AND earned_on=$3`,
    [userId, type, earnedOn]);
  return r.s;
}

/** AI 추천 운동 검증 완료 시 호출 (이미 트랜잭션 안). 트랜잭션 경계는 호출자가 가진다 */
export async function awardAiExercise(c, { userId, exerciseLogId, completedAt }) {
  const { type, points, dailyCap } = POLICY.aiExercise;
  const earnedOn = kstDate(completedAt);
  await lockUser(c, userId);
  const used = await earnedToday(c, userId, type, earnedOn);
  const grant = grantWithCap(points, used, dailyCap);
  if (grant === 0) return { granted: 0, reason: 'DAILY_CAP_REACHED' };
  const ok = await applyPoints(c, { userId, type, points: grant, refId: exerciseLogId, key: `AI_EX:${exerciseLogId}`, earnedOn });
  return { granted: ok ? grant : 0, reason: ok ? (grant < points ? 'PARTIAL_CAP' : 'OK') : 'DUPLICATE' };
}

/** 연속 금연 구간의 시작 = max(금연 시작일, 마지막 흡연 기록) */
export async function streakStartOf(c, userId) {
  const { rows: [p] } = await c.query('SELECT quit_start_date FROM user_profiles WHERE user_id=$1', [userId]);
  if (!p) throw Object.assign(new Error('profile not found'), { status: 404 });
  const { rows: [s] } = await c.query(
    'SELECT MAX(logged_at) AS last FROM smoke_logs WHERE user_id=$1 AND logged_at >= $2', [userId, p.quit_start_date]);
  return s.last && s.last > p.quit_start_date ? s.last : p.quit_start_date;
}

/** 도달한 마일스톤을 모두 지급 (멱등). 키에 스트릭 시작일을 넣어 재금연 시에는 새로 획득 가능 */
export function claimMilestones(userId, now = new Date()) {
  return tx(async (c) => {
    await lockUser(c, userId);
    const start = await streakStartOf(c, userId);
    const days = smokeFreeDays(start, now);
    const granted = [];
    for (const m of milestonesUpTo(days)) {
      const ok = await applyPoints(c, {
        userId, type: POLICY.milestone.type, points: m.points, refId: m.day,
        key: `MS:${userId}:${kstDate(start)}:${m.day}`, earnedOn: kstDate(now) });
      if (ok) granted.push(m);
    }
    return { smokeFreeDays: days, granted, next: nextMilestone(days) };
  });
}

export function pointSummary(userId, now = new Date()) {
  return tx(async (c) => {
    const today = kstDate(now), { type, dailyCap } = POLICY.aiExercise;
    const used = await earnedToday(c, userId, type, today);
    const { rows: [r] } = await c.query('SELECT total_points, weekly_points, monthly_points FROM user_ranks WHERE user_id=$1', [userId]);
    return { totals: r ?? { total_points: 0, weekly_points: 0, monthly_points: 0 },
             aiExercise: { earnedToday: used, dailyCap, remainingToday: dailyCap - used } };
  });
}
