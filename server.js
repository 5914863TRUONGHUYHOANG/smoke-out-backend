const express = require('express');
const cors = require('cors');
const pool = require('./db'); // DB 연동 Gọi file kết nối Database

const app = express();
const port = process.env.PORT || 3000;

// 프론트엔드(Flutter)의 API 호출 허용 Cho phép Frontend (Flutter) gọi API 
app.use(cors());
// 클라이언트에서 보낸 JSON 데이터 읽기 Đọc dữ liệu JSON gửi lên từ client
app.use(express.json());

// 서버 상태 확인 API API kiểm tra trạng thái server
app.get('/', (req, res) => {
    res.json({
        message: 'Smoke Out Backend Server',
        status: 'Node.js 서버 실행 성공'
    });
});

// ==========================================
// [로그인 API] - 쯔엉 후이 황 담당 [API ĐĂNG NHẬP] - Nhiệm vụ của Trương Huy Hoàng
// ==========================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. 이메일로 유저 찾기 Tìm user theo email
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: '메일 주소 존재하지 않습니다!' });
        }

        const user = result.rows[0];

        // 2. 비밀번호 검증 (임시로 평문 비교, 추후 암호화 라이브러리 적용 예정) Kiểm tra mật khẩu (Tạm thời so sánh chữ thường, sau này sẽ dùng thư viện mã hóa)
        if (password !== user.password_hash) {
            return res.status(401).json({ success: false, message: '비번 일치지 않습니다!' });
        }

        // 3. 로그인 성공 Đăng nhập thành công
        res.json({
            success: true,
            message: '로그인 성공!',
            data: {
                user_id: user.user_id, // 이제 안전한 UUID 형식입니다 Bây giờ là dạng UUID an toàn
                username: user.username,
                email: user.email
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: '서버 오류 문제 발생' });
    }
});

// 서버 실행 Khởi động server
app.listen(port, () => {
    console.log(`현재 실행하고 있는 서버의 링크: http://localhost:${port}`);
});