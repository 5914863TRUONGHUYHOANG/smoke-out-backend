/** Builds the safety/ranking context from the DB. `db` only needs a .query(sql, params) method. */
export async function buildContext(db, userId, input) {
  const { rows: [profile] } = await db.query(
    'SELECT fitness_level, health_flags FROM user_profiles WHERE user_id=$1', [userId]);
  if (!profile) throw Object.assign(new Error('profile not found'), { status: 404 });

  const [{ rows: exercises }, { rows: recent }, { rows: eff }] = await Promise.all([
    db.query('SELECT * FROM exercises WHERE is_active'),
    db.query(`SELECT DISTINCT exercise_id FROM exercise_logs
              WHERE user_id=$1 AND completed_at > now() - interval '3 days'`, [userId]),
    db.query(`SELECT l.exercise_id, AVG(s.intensity_before - l.intensity_after)::float AS drop
              FROM exercise_logs l JOIN symptom_logs s USING (symptom_log_id)
              WHERE l.user_id=$1 AND s.symptom_type=$2 AND l.intensity_after IS NOT NULL
              GROUP BY l.exercise_id`, [userId, input.symptomType]),
  ]);

  return {
    exercises,
    ctx: {
      symptomType: input.symptomType, cravingLevel: input.cravingLevel,
      fitnessLevel: profile.fitness_level, healthFlags: profile.health_flags,
      availableMinutes: input.availableMinutes, location: input.location, hasEquipment: input.hasEquipment ?? false,
      recentExerciseIds: new Set(recent.map((r) => Number(r.exercise_id))),
      effectiveness: new Map(eff.map((r) => [Number(r.exercise_id), r.drop])),
    },
  };
}
