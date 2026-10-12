import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { hashPassword, verifyPassword, registerUser, loginUser } from '../src/auth.js';

function createFakeDb() {
  const users = [];
  const profiles = [];
  const ranks = [];
  let nextId = 1;

  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT 1 FROM users WHERE email = $1')) {
        const found = users.some((u) => u.email === params[0]);
        return { rowCount: found ? 1 : 0, rows: found ? [{ '?column?': 1 }] : [] };
      }

      if (normalized.startsWith('SELECT 1 FROM users WHERE nickname = $1')) {
        const found = users.some((u) => u.nickname === params[0]);
        return { rowCount: found ? 1 : 0, rows: found ? [{ '?column?': 1 }] : [] };
      }

      if (normalized.startsWith('INSERT INTO users')) {
        const [email, password_hash, nickname] = params;
        const user = {
          user_id: String(nextId++),
          email,
          password_hash,
          nickname,
          created_at: new Date(),
          last_access_at: new Date(),
        };
        users.push(user);
        return { rowCount: 1, rows: [user] };
      }

      if (normalized.startsWith('INSERT INTO user_profiles')) {
        const [user_id, quit_start_date, daily_cigarette_count, pack_price, fitness_level = 'BEGINNER', health_flags = []] = params;
        if (!profiles.some((p) => p.user_id === String(user_id))) {
          profiles.push({
            user_id: String(user_id),
            quit_start_date,
            daily_cigarette_count,
            pack_price,
            fitness_level,
            health_flags,
          });
        }
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith('INSERT INTO user_ranks')) {
        const [user_id] = params;
        if (!ranks.some((r) => r.user_id === String(user_id))) {
          ranks.push({ user_id: String(user_id), total_points: 0 });
        }
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith('SELECT u.user_id, u.email, u.password_hash, u.nickname')) {
        const user = users.find((u) => u.email === params[0]);
        if (!user) return { rowCount: 0, rows: [] };
        const profile = profiles.find((p) => p.user_id === user.user_id);
        const rank = ranks.find((r) => r.user_id === user.user_id);
        return {
          rowCount: 1,
          rows: [
            {
              ...user,
              fitness_level: profile?.fitness_level ?? 'BEGINNER',
              quit_start_date: profile?.quit_start_date ?? null,
              total_points: rank?.total_points ?? 0,
            },
          ],
        };
      }

      if (normalized.startsWith('UPDATE users SET last_access_at')) {
        const user = users.find((u) => u.user_id === String(params[0]));
        if (user) user.last_access_at = new Date();
        return { rowCount: user ? 1 : 0, rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${normalized}`);
    },
  };

  return {
    users,
    profiles,
    ranks,
    db: {
      query: (sql, params) => client.query(sql, params),
      tx: (fn) => fn(client),
    },
  };
}

test('비밀번호 해싱 및 검증이 정상 동작한다 (scrypt + 레거시 호환)', () => {
  const hash = hashPassword('mySecret123');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('mySecret123', hash), true);
  assert.equal(verifyPassword('wrongPassword', hash), false);
  assert.equal(verifyPassword('123456', '123456'), true);
  assert.equal(verifyPassword('123456', '654321'), false);
});

test('회원가입 성공 시 users, user_profiles, user_ranks가 모두 생성된다', async () => {
  const fake = createFakeDb();
  const res = await registerUser(
    {
      email: 'Hoang@Example.com ',
      password: 'password123',
      nickname: '황이',
      dailyCigaretteCount: 12,
      packPrice: 4500,
      fitnessLevel: 'INTERMEDIATE',
    },
    fake,
  );

  assert.equal(res.success, true);
  assert.equal(res.data.user_id, 1);
  assert.equal(res.data.email, 'hoang@example.com');
  assert.equal(res.data.nickname, '황이');
  assert.equal(fake.users.length, 1);
  assert.equal(fake.profiles.length, 1);
  assert.equal(fake.ranks.length, 1);
  assert.equal(fake.profiles[0].fitness_level, 'INTERMEDIATE');
});

test('회원가입 시 중복 이메일 또는 중복 닉네임은 409 에러를 반환한다', async () => {
  const fake = createFakeDb();
  await registerUser(
    { email: 'user1@test.com', password: 'password123', username: 'Tester1' },
    fake,
  );

  await assert.rejects(
    () => registerUser({ email: 'user1@test.com', password: 'password123', nickname: 'Tester2' }, fake),
    (err) => err.status === 409 && err.message.includes('이메일'),
  );

  await assert.rejects(
    () => registerUser({ email: 'user2@test.com', password: 'password123', nickname: 'Tester1' }, fake),
    (err) => err.status === 409 && err.message.includes('닉네임'),
  );
});

test('회원가입 입력값 검증 실패 시 ZodError가 발생한다', async () => {
  const fake = createFakeDb();
  await assert.rejects(
    () => registerUser({ email: 'not-an-email', password: '123', nickname: 'A' }, fake),
    z.ZodError,
  );
});

test('로그인 성공 및 실패(이메일 없음, 비밀번호 불일치) 처리', async () => {
  const fake = createFakeDb();
  await registerUser(
    { email: 'login@test.com', password: 'secretPassword', nickname: 'LoginUser' },
    fake,
  );

  const ok = await loginUser({ email: 'LOGIN@test.com', password: 'secretPassword' }, fake);
  assert.equal(ok.success, true);
  assert.equal(ok.data.user_id, 1);
  assert.equal(ok.data.nickname, 'LoginUser');

  await assert.rejects(
    () => loginUser({ email: 'login@test.com', password: 'wrongPassword' }, fake),
    (err) => err.status === 401,
  );

  await assert.rejects(
    () => loginUser({ email: 'nobody@test.com', password: 'secretPassword' }, fake),
    (err) => err.status === 401,
  );
});

