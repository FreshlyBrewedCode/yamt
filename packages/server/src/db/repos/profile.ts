import type { DailyLife, Profile, ProfileBody, Sex, Training } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  sex: Sex;
  birth_year: number;
  height_cm: number;
  body_fat_pct: number | null;
  daily_life: DailyLife;
  training: string;
  updated_at: number;
}

const toProfile = (r: Row): Profile => ({
  sex: r.sex,
  birthYear: r.birth_year,
  heightCm: r.height_cm,
  bodyFatPct: r.body_fat_pct,
  dailyLife: r.daily_life,
  training: JSON.parse(r.training) as Training,
  updatedAt: r.updated_at,
});

/** The body profile (#24): one row, replaced as a whole. */
export class ProfileRepo {
  constructor(private readonly db: Db) {}

  get(): Profile | null {
    const r = this.db.query<Row, []>("SELECT * FROM profile WHERE id = 1").get();
    return r ? toProfile(r) : null;
  }

  put(p: ProfileBody, now = Date.now()): Profile {
    this.db
      .query(
        `INSERT INTO profile (id, sex, birth_year, height_cm, body_fat_pct, daily_life, training, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET sex = excluded.sex, birth_year = excluded.birth_year,
           height_cm = excluded.height_cm, body_fat_pct = excluded.body_fat_pct,
           daily_life = excluded.daily_life, training = excluded.training, updated_at = excluded.updated_at`,
      )
      .run(p.sex, p.birthYear, p.heightCm, p.bodyFatPct, p.dailyLife, JSON.stringify(p.training), now);
    return this.get()!;
  }
}
