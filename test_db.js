import pool from './db.js';

async function createDummyUser() {
    try {
        const query = `
            INSERT INTO users (username, email, password_hash)
            VALUES ($1, $2, $3)
            ON CONFLICT (email) DO NOTHING;
        `;
        await pool.query(query, ['Tester', 'test@gmail.com', '123456']);
        
        console.log('✅ testing계정 만들었습니다! Email: test@gmail.com | Pass: 123456');
    } catch (error) {
        console.error('❌ 계정 만들기 실폐:', error);
    } finally {
        pool.end();
    }
}

createDummyUser();