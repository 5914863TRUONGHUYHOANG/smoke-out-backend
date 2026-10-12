import { pool, tx } from './src/db.js';
import { hashPassword } from './src/auth.js';

async function createDummyUser() {
  try {
    const user = await tx(async (c) => {
      const passwordHash = hashPassword('123456');
      const { rows } = await c.query(
        `INSERT INTO users (nickname, email, password_hash, last_access_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash
         RETURNING user_id, nickname, email`,
        ['Tester', 'test@gmail.com', passwordHash],
      );
      const u = rows[0];
      await c.query(
        `INSERT INTO user_profiles (user_id, quit_start_date, daily_cigarette_count, pack_price, fitness_level)
         VALUES ($1, NOW() - INTERVAL '10 days', 10, 4500, 'BEGINNER')
         ON CONFLICT (user_id) DO NOTHING`,
        [u.user_id],
      );
      await c.query(
        `INSERT INTO user_ranks (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.user_id],
      );
      return u;
    });

    console.log(
      `✅ 테스트 계정이 준비되었습니다! user_id: ${user.user_id} | Email: ${user.email} | Pass: 123456`,
    );
  } catch (error) {
    console.error('❌ 테스트 계정 생성 실패:', error);
  } finally {
    await pool.end();
  }
}

createDummyUser();