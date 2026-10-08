// 포인트 정책: 순수 함수만 둔다 (DB/시간 의존 없음 → 테스트 쉬움)
export const POLICY = Object.freeze({
  aiExercise: { type: 'AI_EXERCISE', points: 10, dailyCap: 50 },
  milestone: {
    type: 'SMOKE_FREE_MILESTONE',
    first:  { day: 3, points: 30 },
    second: { day: 7, points: 40 },
    // second.day 이후 10일마다: 17, 27, 37 ...
    recurring: { everyDays: 10, points: 60 },
  },
  tzOffsetHours: 9, // Asia/Seoul (DST 없음)
});

const DAY = 86_400_000;

/** Date → 'YYYY-MM-DD' (KST 달력 기준) */
export function kstDate(d) {
  return new Date(new Date(d).getTime() + POLICY.tzOffsetHours * 3_600_000).toISOString().slice(0, 10);
}

/** 금연 시작(스트릭 시작) 이후 KST 달력일 기준 경과 일수. 시:분 무관, 자정 기준 */
export function smokeFreeDays(streakStart, now) {
  const diff = (Date.parse(kstDate(now)) - Date.parse(kstDate(streakStart))) / DAY;
  return Math.max(0, diff);
}

/** 경과 일수까지 도달한 모든 마일스톤 (앱을 늦게 열어도 놓친 보상을 따라잡기 위함) */
export function milestonesUpTo(days) {
  const { first, second, recurring } = POLICY.milestone;
  const out = [];
  if (days >= first.day)  out.push({ day: first.day,  points: first.points });
  if (days >= second.day) out.push({ day: second.day, points: second.points });
  for (let d = second.day + recurring.everyDays; d <= days; d += recurring.everyDays)
    out.push({ day: d, points: recurring.points });
  return out;
}

/** 다음 마일스톤 (UI 표시용) */
export function nextMilestone(days) {
  const { first, second, recurring } = POLICY.milestone;
  if (days < first.day)  return { day: first.day,  points: first.points };
  if (days < second.day) return { day: second.day, points: second.points };
  const k = Math.floor((days - second.day) / recurring.everyDays) + 1;
  return { day: second.day + k * recurring.everyDays, points: recurring.points };
}

/** 일일 한도 적용: 한도 초과분은 잘라서(부분 지급) 한도를 절대 넘지 않게 한다 */
export function grantWithCap(base, alreadyToday, cap) {
  return Math.max(0, Math.min(base, cap - alreadyToday));
}
