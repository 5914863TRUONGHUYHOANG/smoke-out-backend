import pg from 'pg';

pg.types.setTypeParser(1114, (value) => new Date(`${value.replace(' ', 'T')}Z`));

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      user: process.env.DB_USER || 'app',
      host: process.env.DB_HOST || '127.0.0.1',
      database: process.env.DB_NAME || 'quitsmoke',
      password: process.env.DB_PASSWORD || 'change_me_please',
      port: Number(process.env.DB_PORT || 5433),
    };

export const pool = new pg.Pool(poolConfig);
pool.on('connect', (client) => client.query("SET TIME ZONE 'UTC'"));

export async function tx(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default pool;
