import pg from 'pg';

const { Pool } = pg;
let pool;

export function dbReady() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL manquant. Ajoute PostgreSQL sur Railway puis référence DATABASE_URL.');
    }

    const sslRequired =
      process.env.PGSSLMODE === 'require' ||
      process.env.DATABASE_URL.includes('sslmode=require');

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslRequired ? { rejectUnauthorized: false } : undefined
    });
  }

  return pool;
}

export async function query(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

export async function initDatabase() {
  const db = getPool();

  await db.query(`
    create table if not exists teams (
      id serial primary key,
      code text not null unique,
      name text not null,
      player_one text not null default '',
      player_two text not null default '',
      house text not null default '',
      score integer not null default 0,
      malus integer not null default 0,
      qualified boolean not null default false,
      eliminated boolean not null default false,
      created_at timestamptz not null default now()
    );

    create table if not exists questions (
      id serial primary key,
      play_order integer not null default 0,
      round_key text not null,
      pool_key text not null default '',
      type text not null default 'text',
      theme text not null default '',
      prompt text not null,
      answer text not null default '',
      media_url text not null default '',
      media_url_b text not null default '',
      options jsonb not null default '[]'::jsonb,
      duration_seconds integer not null default 0,
      blur_level integer not null default 14,
      created_at timestamptz not null default now()
    );

    create table if not exists game_state (
      id integer primary key default 1,
      phase text not null default 'welcome',
      round_key text not null default 'welcome',
      pool_key text not null default '',
      current_question_id integer references questions(id) on delete set null,
      reveal_answer boolean not null default false,
      public_mode text not null default 'welcome',
      timer_label text not null default '',
      timer_ends_at timestamptz,
      timer_duration integer not null default 0,
      timer_running boolean not null default false,
      buzz_locked boolean not null default false,
      buzz_winner_team_id integer references teams(id) on delete set null,
      vote_open boolean not null default false,
      vote_title text not null default '',
      vote_options jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists votes (
      id serial primary key,
      device_id text not null,
      option_id text not null,
      created_at timestamptz not null default now(),
      unique(device_id)
    );

    create table if not exists buzzes (
      id serial primary key,
      team_id integer not null references teams(id) on delete cascade,
      created_at timestamptz not null default now()
    );

    insert into game_state (id)
    values (1)
    on conflict (id) do nothing;
  `);

  await seedTeams();
}

async function seedTeams() {
  const rows = await query('select count(*)::int as count from teams');
  if (rows[0]?.count > 0) return;

  const names = ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'];
  for (let index = 0; index < names.length; index += 1) {
    await query(
      'insert into teams (code, name) values ($1, $2) on conflict (code) do nothing',
      [`team-${index + 1}`, names[index]]
    );
  }
}
