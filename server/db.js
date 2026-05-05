import pg from 'pg';

const { Pool } = pg;

let pool;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required. Add a PostgreSQL database on Railway or in .env.');
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

export async function query(text, params = []) {
  const db = getPool();
  const result = await db.query(text, params);
  return result.rows;
}

export async function initDatabase() {
  const db = getPool();

  await db.query(`
    create table if not exists teams (
      id serial primary key,
      name text not null,
      player_one text not null default '',
      player_two text not null default '',
      score integer not null default 0,
      malus integer not null default 0,
      eliminated boolean not null default false,
      created_at timestamptz not null default now()
    );

    create table if not exists questions (
      id serial primary key,
      theme text not null default '',
      type text not null default 'text',
      prompt text not null,
      answer text not null default '',
      media_url text not null default '',
      options jsonb not null default '[]'::jsonb,
      blur_level integer not null default 12,
      created_at timestamptz not null default now()
    );

    create table if not exists game_state (
      id integer primary key default 1,
      status text not null default 'lobby',
      round_number integer not null default 1,
      current_question_id integer references questions(id) on delete set null,
      reveal_answer boolean not null default false,
      updated_at timestamptz not null default now()
    );

    insert into game_state (id)
    values (1)
    on conflict (id) do nothing;
  `);
}
