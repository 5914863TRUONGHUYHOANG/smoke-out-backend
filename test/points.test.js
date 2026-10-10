import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_AI_EXERCISE_POINT_CAP,
  pointsFor,
  quitMilestonePointsFor,
} from '../src/verification.js';
import { milestonesUpTo, nextMilestone, grantWithCap, smokeFreeDays, kstDate } from '../src/points/policy.js';

test('검증된 AI 추천 운동은 하루 최대 50포인트까지 10포인트씩 지급한다', () => {
  assert.equal(pointsFor(), 10);
  assert.equal(pointsFor(0), 10);
  assert.equal(pointsFor(40), 10);
  assert.equal(pointsFor(DAILY_AI_EXERCISE_POINT_CAP), 0);
  assert.equal(pointsFor(60), 0);
});

test('금연 일수 보상은 3일, 7일, 이후 10일 단위로 지급한다', () => {
  assert.equal(quitMilestonePointsFor(3), 30);
  assert.equal(quitMilestonePointsFor(7), 40);
  assert.equal(quitMilestonePointsFor(10), 60);
  assert.equal(quitMilestonePointsFor(20), 60);
  assert.equal(quitMilestonePointsFor(4), 0);
  assert.equal(quitMilestonePointsFor(15), 0);
});

test('마일스톤: 3일 30, 7일 40, 이후 10일마다 60', () => {
  assert.deepEqual(milestonesUpTo(2), []);
  assert.deepEqual(milestonesUpTo(3), [{ day: 3, points: 30 }]);
  assert.deepEqual(milestonesUpTo(16).map((m) => m.day), [3, 7]);
  assert.deepEqual(milestonesUpTo(27), [
    { day: 3, points: 30 }, { day: 7, points: 40 }, { day: 17, points: 60 }, { day: 27, points: 60 }]);
});
test('다음 마일스톤', () => {
  assert.equal(nextMilestone(0).day, 3);
  assert.equal(nextMilestone(3).day, 7);
  assert.equal(nextMilestone(7).day, 17);
  assert.equal(nextMilestone(26).day, 27);
  assert.equal(nextMilestone(27).day, 37);
});
test('일일 한도 50: 5회까지 10점, 6회째 0점', () => {
  let used = 0, got = [];
  for (let i = 0; i < 6; i++) { const g = grantWithCap(10, used, 50); got.push(g); used += g; }
  assert.deepEqual(got, [10, 10, 10, 10, 10, 0]);
});
test('한도 부분 지급 (정책 변경 대비)', () => assert.equal(grantWithCap(10, 45, 50), 5));
test('KST 달력일 경계: UTC 14:59 → 같은 날, 15:00 → 다음 날', () => {
  assert.equal(kstDate('2026-10-01T14:59:59Z'), '2026-10-01');
  assert.equal(kstDate('2026-10-01T15:00:00Z'), '2026-10-02');
});
test('금연 일수는 자정(KST) 기준', () => {
  assert.equal(smokeFreeDays('2026-09-29T23:00:00+09:00', '2026-10-02T00:10:00+09:00'), 3);
  assert.equal(smokeFreeDays('2026-09-29T00:00:00+09:00', '2026-10-01T23:59:00+09:00'), 2);
});
