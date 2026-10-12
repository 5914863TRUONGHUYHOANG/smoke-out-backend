import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool, tx } from './db.js';

const SCRYPT_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${SCRYPT_PREFIX}$${salt}$${derivedKey}`;
}

export function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string' || !storedHash) {
    return false;
  }

  if (storedHash.startsWith(`${SCRYPT_PREFIX}$`)) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, keyHex] = parts;
    try {
      const keyBuffer = Buffer.from(keyHex, 'hex');
      const derivedBuffer = scryptSync(password, salt, KEY_LENGTH);
      if (keyBuffer.length !== derivedBuffer.length) return false;
      return timingSafeEqual(keyBuffer, derivedBuffer);
    } catch {
      return false;
    }
  }

  // Legacy plaintext fallback for pre-existing test rows
  const a = Buffer.from(password, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const HEALTH_FLAGS = [
  'HEART_CONDITION',
  'HYPERTENSION',
  'ASTHMA',
  'PREGNANCY',
  'JOINT_PAIN',
  'BACK_PAIN',
];

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('유효한 이메일 주소를 입력해주세요.').max(255),
    password: z.string().min(6, '비밀번호는 최소 6자 이상이어야 합니다.').max(128),
    nickname: z.string().trim().min(2, '닉네임은 최소 2자 이상이어야 합니다.').max(50).optional(),
    username: z.string().trim().min(2, '닉네임은 최소 2자 이상이어야 합니다.').max(50).optional(),
    quitStartDate: z
      .string()
      .refine((val) => !Number.isNaN(Date.parse(val)), '유효한 날짜 형식이 아닙니다.')
      .optional(),
    dailyCigaretteCount: z.coerce.number().int().min(0).max(200).default(0),
    packPrice: z.coerce.number().int().min(0).max(1_000_000).default(4500),
    fitnessLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
    healthFlags: z.array(z.enum(HEALTH_FLAGS)).default([]),
  })
  .refine((data) => Boolean(data.nickname || data.username), {
    message: 'nickname 또는 username이 필요합니다.',
    path: ['nickname'],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('유효한 이메일 주소를 입력해주세요.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
});

const defaultDeps = {
  db: { query: (sql, params) => pool.query(sql, params), tx },
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function registerUser(rawInput, deps = defaultDeps) {
  const input = registerSchema.parse(rawInput);
  const nickname = (input.nickname ?? input.username).trim();
  const quitStartDate = input.quitStartDate ? new Date(input.quitStartDate) : new Date();
  const passwordHash = hashPassword(input.password);

  return deps.db.tx(async (c) => {
    const existingEmail = await c.query('SELECT 1 FROM users WHERE email = $1', [input.email]);
    if (existingEmail.rowCount > 0) {
      throw httpError(409, '이미 사용 중인 이메일입니다.');
    }

    const existingNickname = await c.query('SELECT 1 FROM users WHERE nickname = $1', [nickname]);
    if (existingNickname.rowCount > 0) {
      throw httpError(409, '이미 사용 중인 닉네임입니다.');
    }

    const {
      rows: [user],
    } = await c.query(
      `INSERT INTO users (email, password_hash, nickname, last_access_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING user_id, email, nickname, created_at`,
      [input.email, passwordHash, nickname],
    );

    await c.query(
      `INSERT INTO user_profiles
         (user_id, quit_start_date, daily_cigarette_count, pack_price, fitness_level, health_flags)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.user_id,
        quitStartDate,
        input.dailyCigaretteCount,
        input.packPrice,
        input.fitnessLevel,
        input.healthFlags,
      ],
    );

    await c.query(
      `INSERT INTO user_ranks (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.user_id],
    );

    const userId = Number(user.user_id);
    return {
      success: true,
      message: '회원가입 성공!',
      data: {
        user_id: userId,
        userId,
        nickname: user.nickname,
        username: user.nickname,
        email: user.email,
        fitness_level: input.fitnessLevel,
        quit_start_date: quitStartDate.toISOString(),
      },
    };
  });
}

export async function loginUser(rawInput, deps = defaultDeps) {
  const input = loginSchema.parse(rawInput);

  const {
    rows: [user],
  } = await deps.db.query(
    `SELECT u.user_id, u.email, u.password_hash, u.nickname,
            p.fitness_level, p.quit_start_date,
            COALESCE(r.total_points, 0)::int AS total_points
     FROM users u
     LEFT JOIN user_profiles p ON p.user_id = u.user_id
     LEFT JOIN user_ranks r ON r.user_id = u.user_id
     WHERE u.email = $1`,
    [input.email],
  );

  if (!user) {
    throw httpError(401, '존재하지 않는 이메일이거나 비밀번호가 일치하지 않습니다.');
  }

  if (!verifyPassword(input.password, user.password_hash)) {
    throw httpError(401, '존재하지 않는 이메일이거나 비밀번호가 일치하지 않습니다.');
  }

  await deps.db.tx(async (c) => {
    await c.query('UPDATE users SET last_access_at = NOW() WHERE user_id = $1', [user.user_id]);
    await c.query(
      `INSERT INTO user_profiles (user_id, quit_start_date, daily_cigarette_count, pack_price)
       VALUES ($1, NOW(), 0, 4500)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.user_id],
    );
    await c.query(
      `INSERT INTO user_ranks (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.user_id],
    );
  });

  const userId = Number(user.user_id);
  return {
    success: true,
    message: '로그인 성공!',
    data: {
      user_id: userId,
      userId,
      nickname: user.nickname,
      username: user.nickname,
      email: user.email,
      fitness_level: user.fitness_level ?? 'BEGINNER',
      total_points: user.total_points ?? 0,
    },
  };
}

