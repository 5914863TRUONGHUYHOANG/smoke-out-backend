import { tx } from './db.js';

export function awardDueQuitMilestones() {
  return tx(async (c) => {
    const { rowCount } = await c.query(
      `WITH streaks AS (
         SELECT user_id, quit_start_date, CURRENT_DATE - quit_start_date AS day_count
         FROM users
         WHERE quit_start_date <= CURRENT_DATE - 3
       ),
       milestones AS (
         SELECT user_id, quit_start_date, 3 AS day_count, 30 AS points
         FROM streaks WHERE day_count >= 3
         UNION ALL
         SELECT user_id, quit_start_date, 7, 40
         FROM streaks WHERE day_count >= 7
         UNION ALL
         SELECT s.user_id, s.quit_start_date, days.day_count, 60
         FROM streaks s
         CROSS JOIN LATERAL generate_series(10, s.day_count, 10) AS days(day_count)
       )
       INSERT INTO point_logs(user_id, point_type, points, reference_key, earned_on)
       SELECT user_id, 'QUIT_MILESTONE', points,
              'quit-' || quit_start_date::text || '-day-' || day_count,
              quit_start_date + day_count
       FROM milestones
       ON CONFLICT (user_id, point_type, reference_key) DO NOTHING`
    );
    return rowCount;
  });
}
