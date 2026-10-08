import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, passesSafety, pickValid } from '../src/reco/ranking.js';

const mk = (id, o = {}) => ({
  exercise_id: id, title: `ex${id}`, is_active: true, duration_minutes: 5, intensity: 'LOW',
  target_symptoms: ['CRAVING'], min_fitness_level: 'BEGINNER', location: 'ANY', requires_equipment: false,
  contraindications: [], craving_min: 0, craving_max: 10, tags: [], ...o });
const ctx = (o = {}) => ({ symptomType: 'CRAVING', cravingLevel: 8, fitnessLevel: 'BEGINNER', healthFlags: [],
  availableMinutes: 15, location: 'ANY', hasEquipment: false, recentExerciseIds: new Set(), effectiveness: new Map(), ...o });

test('건강 주의사항이 겹치면 후보에서 제외', () =>
  assert.equal(passesSafety(mk(1, { contraindications: ['HEART_CONDITION'] }), ctx({ healthFlags: ['HEART_CONDITION'] })), false));
test('체력 수준 미달 / 시간 초과 / 장비 필요 제외', () => {
  assert.equal(passesSafety(mk(1, { min_fitness_level: 'ADVANCED' }), ctx()), false);
  assert.equal(passesSafety(mk(1, { duration_minutes: 30 }), ctx()), false);
  assert.equal(passesSafety(mk(1, { requires_equipment: true }), ctx()), false);
});
test('불면에는 저강도만', () => {
  assert.equal(passesSafety(mk(1, { intensity: 'MEDIUM' }), ctx({ symptomType: 'INSOMNIA' })), false);
  assert.equal(passesSafety(mk(2), ctx({ symptomType: 'INSOMNIA' })), true);
});
test('강한 욕구에는 즉각 완화형이 상위', () => {
  const r = rankCandidates([mk(1), mk(2, { tags: ['QUICK_RELIEF'] })], ctx());
  assert.equal(Number(r[0].exercise.exercise_id), 2);
});
test('최근 수행 운동은 감점, 효과 좋았던 운동은 가점', () => {
  const r = rankCandidates([mk(1), mk(2)], ctx({ recentExerciseIds: new Set([1]), effectiveness: new Map([[2, 3]]) }));
  assert.equal(Number(r[0].exercise.exercise_id), 2);
});
test('증상 일치 후보가 없으면 안전한 운동으로 완화', () => {
  const r = rankCandidates([mk(1, { target_symptoms: ['COUGH'] })], ctx());
  assert.equal(r.length, 1);
});
test('안전한 후보가 하나도 없으면 빈 배열', () =>
  assert.deepEqual(rankCandidates([mk(1, { duration_minutes: 99 })], ctx()), []));
test('LLM이 후보 밖 id를 말하면 거부(환각 차단)', () => {
  const c = rankCandidates([mk(1), mk(2)], ctx());
  assert.equal(pickValid({ exerciseId: 999, reason: 'x' }, c), null);
  assert.equal(Number(pickValid({ exerciseId: 2, reason: 'ok' }, c).candidate.exercise.exercise_id), 2);
});
