// 순수 함수: DB 없이 테스트 가능
export const MIN_AVG_HR = { LOW: 80, MEDIUM: 100, HIGH: 120 };
const MIN = 60_000;

/**
 * @param {object} p
 * exercise {duration_minutes, intensity}, startedAt/completedAt Date,
 * durationCompleted(분), now Date, overlapsOtherLog bool,
 * health [{started_at, ended_at, avg_heart_rate}] 겹치는 헬스 기록
 * @returns {{status:'VERIFIED'|'PENDING'|'REJECTED', reason:string}}
 */
export function verifyExercise({ exercise, startedAt, completedAt, durationCompleted, now = new Date(), overlapsOtherLog = false, health = [] }) {
  const reject = (reason) => ({ status: 'REJECTED', reason });

  if (completedAt > new Date(now.getTime() + 2 * MIN)) return reject('완료 시각이 미래입니다');
  if (now - completedAt > 48 * 60 * MIN) return reject('48시간이 지난 기록은 인정되지 않습니다');
  if (completedAt <= startedAt) return reject('종료 시각이 시작 시각보다 빠릅니다');

  const wallMin = (completedAt - startedAt) / MIN;
  if (durationCompleted > wallMin + 1) return reject('수행 시간이 실제 경과 시간보다 깁니다');

  const ratio = durationCompleted / exercise.duration_minutes;
  if (ratio < 0.8) return reject(`운동 수행률 부족 (${Math.round(ratio * 100)}%, 최소 80%)`);
  if (overlapsOtherLog) return reject('다른 운동 기록과 시간이 겹칩니다');

  // 헬스 데이터 대조
  let overlapMin = 0, hrSum = 0, hrW = 0;
  for (const h of health) {
    const s = Math.max(startedAt, new Date(h.started_at));
    const e = Math.min(completedAt, new Date(h.ended_at));
    const o = Math.max(0, (e - s) / MIN);
    overlapMin += o;
    if (h.avg_heart_rate) { hrSum += h.avg_heart_rate * o; hrW += o; }
  }
  if (overlapMin === 0) return { status: 'PENDING', reason: '헬스 데이터 대기 중 (동기화 후 자동 검증)' };

  if (overlapMin < durationCompleted * 0.7)
    return reject(`헬스 기록과 겹치는 시간 부족 (${overlapMin.toFixed(0)}분/${durationCompleted}분)`);

  if (hrW > 0) {
    const avg = hrSum / hrW, min = MIN_AVG_HR[exercise.intensity] ?? 80;
    if (avg < min) return reject(`평균 심박수 ${avg.toFixed(0)}bpm < 기준 ${min}bpm (${exercise.intensity})`);
  }
  return { status: 'VERIFIED', reason: '헬스 데이터로 검증됨' };
}

export const AI_EXERCISE_POINTS = 10;
export const DAILY_AI_EXERCISE_POINT_CAP = 50;

export function pointsFor(dailyPoints = 0) {
  return Math.max(0, Math.min(AI_EXERCISE_POINTS, DAILY_AI_EXERCISE_POINT_CAP - dailyPoints));
}

export function quitMilestonePointsFor(dayCount) {
  if (dayCount === 3) return 30;
  if (dayCount === 7) return 40;
  if (dayCount >= 10 && dayCount % 10 === 0) return 60;
  return 0;
}
