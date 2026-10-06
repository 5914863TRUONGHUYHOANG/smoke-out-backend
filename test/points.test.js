import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_AI_EXERCISE_POINT_CAP,
  pointsFor,
  quitMilestonePointsFor,
} from '../src/verification.js';

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
