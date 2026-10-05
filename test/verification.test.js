import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyExercise } from '../src/verification.js';

const now = new Date('2026-10-02T12:00:00Z');
const ex = { duration_minutes: 20, intensity: 'MEDIUM' };
const base = { exercise: ex, now, startedAt: new Date('2026-10-02T11:00:00Z'), completedAt: new Date('2026-10-02T11:20:00Z'), durationCompleted: 20 };

test('헬스 데이터 없으면 PENDING', () => assert.equal(verifyExercise(base).status, 'PENDING'));
test('수행률 80% 미만 REJECTED', () => assert.equal(verifyExercise({ ...base, durationCompleted: 10 }).status, 'REJECTED'));
test('심박 충분하면 VERIFIED', () => assert.equal(verifyExercise({ ...base, health: [{ started_at: '2026-10-02T11:00:00Z', ended_at: '2026-10-02T11:20:00Z', avg_heart_rate: 120 }] }).status, 'VERIFIED'));
test('심박 낮으면 REJECTED', () => assert.equal(verifyExercise({ ...base, health: [{ started_at: '2026-10-02T11:00:00Z', ended_at: '2026-10-02T11:20:00Z', avg_heart_rate: 70 }] }).status, 'REJECTED'));
test('미래 시각 REJECTED', () => assert.equal(verifyExercise({ ...base, completedAt: new Date('2026-10-03T00:00:00Z') }).status, 'REJECTED'));
