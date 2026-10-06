import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuitMilestoneNotification } from '../src/notifications.js';

test('10일 금연 응원 알림을 생성한다', () => {
  assert.deepEqual(buildQuitMilestoneNotification(10), {
    type: 'QUIT_MILESTONE',
    key: 'quit-day-10',
    title: '금연 10일째, 정말 대단해요!',
    body: '10일 동안 이어온 금연, 오늘도 계속 응원할게요. 스스로를 마음껏 칭찬해 주세요!',
  });
});

test('금연 응원 알림은 10일 단위만 허용한다', () => {
  assert.throws(() => buildQuitMilestoneNotification(0), RangeError);
  assert.throws(() => buildQuitMilestoneNotification(11), RangeError);
});
