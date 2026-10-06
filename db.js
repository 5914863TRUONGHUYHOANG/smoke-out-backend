const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://app:change_me_please@localhost:5433/quitsmoke'
});

pool.connect()
    .then(() => console.log('✅ Đã kết nối thành công với PostgreSQL Database!'))
    .catch(err => console.error('❌ Lỗi kết nối Database:', err.message));

module.exports = pool;