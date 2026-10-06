// ==========================================
// [로그인 API] - 쯔엉 후이 황 담당 [API ĐĂNG NHẬP]
// ==========================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: '메일 주소 존재하지 않습니다!' });
        }

        const user = result.rows[0];

        if (password !== user.password_hash) {
            return res.status(401).json({ success: false, message: '비번 일치지 않습니다!' });
        }

        res.json({
            success: true,
            message: '로그인 성공!',
            data: {
                user_id: user.user_id,
                username: user.username,
                email: user.email
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: '서버 오류 문제 발생' });
    }
});