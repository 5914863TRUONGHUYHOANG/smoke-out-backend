import pg from 'pg';

// timestamp(타임존 없음)는 항상 UTC로 저장/해석한다. 서버 TZ에 따라 값이 어긋나는 버그 방지
pg.types.setTypeParser(1114, (s) => new Date(s.replace(' ', 'T') + 'Z'));

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('connect', (c) => c.query("SET TIME ZONE 'UTC'"));

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
