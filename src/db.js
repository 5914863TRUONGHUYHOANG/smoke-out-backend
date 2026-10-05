import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.DB_USER || 'app',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'quitsmoke',
  password: process.env.DB_PASSWORD || 'change_me_please',
  port: process.env.DB_PORT || 5433,
});

export const tx = async (callback) => {
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
};

export default pool;
