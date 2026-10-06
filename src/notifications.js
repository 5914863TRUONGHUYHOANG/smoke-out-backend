import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { pool } from './db.js';
import { awardDueQuitMilestones } from './points.js';

const schedulerIntervalMs = 60_000;
const maxAttempts = 10;
const batchSize = 20;
let schedulerStarted = false;
const invalidTokenCodes = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

export function buildQuitMilestoneNotification(dayCount) {
  if (!Number.isInteger(dayCount) || dayCount <= 0 || dayCount % 10 !== 0) {
    throw new RangeError('Quit milestone must be a positive multiple of 10 days');
  }
  return {
    type: 'QUIT_MILESTONE',
    key: `quit-day-${dayCount}`,
    title: `금연 ${dayCount}일째, 정말 대단해요!`,
    body: `${dayCount}일 동안 이어온 금연, 오늘도 계속 응원할게요. 스스로를 마음껏 칭찬해 주세요!`,
  };
}

async function enqueueDueNotifications() {
  const { rows: inactiveUsers } = await pool.query(
    `SELECT u.user_id::text AS user_id,
            to_char(u.last_access_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS access_key
     FROM users u
     WHERE u.last_access_at <= NOW() - INTERVAL '24 hours'
       AND EXISTS (SELECT 1 FROM fcm_device_tokens t WHERE t.user_id = u.user_id::text)`
  );

  for (const user of inactiveUsers) {
    await pool.query(
      `INSERT INTO notification_outbox
         (user_id, notification_type, notification_key, title, body)
       VALUES ($1, 'INACTIVITY', $2, $3, $4)
       ON CONFLICT (user_id, notification_type, notification_key) DO NOTHING`,
      [
        user.user_id,
        `last-access-${user.access_key}`,
        '오늘도 금연을 응원해요!',
        '금연 여정을 이어가고 있어요. 오늘도 담배 대신 나를 위한 선택을 응원합니다!',
      ]
    );
  }

  const { rows: milestoneUsers } = await pool.query(
    `SELECT u.user_id::text AS user_id,
            (CURRENT_DATE - u.quit_start_date)::integer AS day_count
     FROM users u
     WHERE u.quit_start_date < CURRENT_DATE
       AND (CURRENT_DATE - u.quit_start_date) % 10 = 0
       AND EXISTS (SELECT 1 FROM fcm_device_tokens t WHERE t.user_id = u.user_id::text)`
  );

  for (const user of milestoneUsers) {
    const notification = buildQuitMilestoneNotification(user.day_count);
    await pool.query(
      `INSERT INTO notification_outbox
         (user_id, notification_type, notification_key, title, body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, notification_type, notification_key) DO NOTHING`,
      [user.user_id, notification.type, notification.key, notification.title, notification.body]
    );
  }
}

async function claimNotifications() {
  const { rows } = await pool.query(
    `WITH claimable AS (
       SELECT notification_id
       FROM notification_outbox
       WHERE (status = 'PENDING' AND next_attempt_at <= NOW())
          OR (status = 'PROCESSING' AND locked_until < NOW())
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE notification_outbox n
     SET status = 'PROCESSING',
         attempts = attempts + 1,
         locked_until = NOW() + INTERVAL '5 minutes'
     FROM claimable c
     WHERE n.notification_id = c.notification_id
     RETURNING n.notification_id, n.user_id, n.notification_type,
               n.notification_key, n.title, n.body, n.attempts`,
    [batchSize]
  );
  return rows;
}

function getFirebaseMessaging() {
  const app = getApps().length ? getApp() : initializeApp({ credential: applicationDefault() });
  return getMessaging(app);
}

async function sendNotification(notification) {
  if (notification.notification_type === 'INACTIVITY') {
    const { rowCount } = await pool.query(
      `SELECT 1
       FROM users u
       WHERE u.user_id::text = $1
         AND u.last_access_at <= NOW() - INTERVAL '24 hours'
         AND 'last-access-' || to_char(u.last_access_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') = $2`,
      [notification.user_id, notification.notification_key]
    );
    if (rowCount === 0) return 'SKIPPED';
  }

  const { rows: tokenRows } = await pool.query(
    'SELECT fcm_token FROM fcm_device_tokens WHERE user_id = $1',
    [notification.user_id]
  );
  const tokens = tokenRows.map(({ fcm_token }) => fcm_token);
  if (tokens.length === 0) return 'SKIPPED';

  const messaging = getFirebaseMessaging();
  let successCount = 0;
  const failedTokens = [];
  const transientErrors = [];

  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const response = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title: notification.title, body: notification.body },
      data: {
        type: notification.notification_type,
        key: notification.notification_key,
      },
    });
    successCount += response.successCount;
    response.responses.forEach((result, index) => {
      if (result.success) return;
      if (invalidTokenCodes.has(result.error?.code)) failedTokens.push(batch[index]);
      else transientErrors.push(result.error?.message ?? 'Unknown FCM delivery error');
    });
  }

  if (failedTokens.length > 0) {
    await pool.query(
      'DELETE FROM fcm_device_tokens WHERE user_id = $1 AND fcm_token = ANY($2::text[])',
      [notification.user_id, failedTokens]
    );
  }
  if (transientErrors.length > 0) throw new Error(transientErrors.join('; ').slice(0, 1000));
  return successCount > 0 ? 'SENT' : 'SKIPPED';
}

async function recordDeliveryFailure(notification, error) {
  const message = String(error?.message ?? error).slice(0, 1000);
  const retryDelaySeconds = Math.min(21_600, 30 * 2 ** Math.min(notification.attempts - 1, 10));
  const status = notification.attempts >= maxAttempts ? 'FAILED' : 'PENDING';
  await pool.query(
    `UPDATE notification_outbox
     SET status = $2,
         next_attempt_at = NOW() + ($3 * INTERVAL '1 second'),
         locked_until = NULL,
         last_error = $4
     WHERE notification_id = $1`,
    [notification.notification_id, status, retryDelaySeconds, message]
  );
  console.error(`FCM delivery failed for notification ${notification.notification_id}: ${message}`);
}

async function deliverPendingNotifications() {
  const notifications = await claimNotifications();
  for (const notification of notifications) {
    try {
      const status = await sendNotification(notification);
      await pool.query(
        `UPDATE notification_outbox
         SET status = $2, sent_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE NULL END,
             locked_until = NULL, last_error = NULL
         WHERE notification_id = $1`,
        [notification.notification_id, status]
      );
    } catch (error) {
      await recordDeliveryFailure(notification, error);
    }
  }
}

async function runNotificationScheduler() {
  await awardDueQuitMilestones();
  await enqueueDueNotifications();
  await deliverPendingNotifications();
}

export function startNotificationScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const run = async () => {
    try {
      await runNotificationScheduler();
    } catch (error) {
      console.error('FCM notification scheduler failed:', error);
    }
    const timer = setTimeout(run, schedulerIntervalMs);
    timer.unref();
  };

  void run();
}
