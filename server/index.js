import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { dbReady, getMemoryStore, initDatabase, query, useMemoryStore } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'lisaa';

app.use(express.json({ limit: '8mb' }));

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  if (token !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe admin incorrect.' });
  }
  next();
}

function deviceId(req) {
  return req.headers['x-device-id'] || crypto.randomUUID();
}

async function snapshot() {
  if (useMemoryStore()) {
    const store = getMemoryStore();
    const currentQuestion = store.questions.find((question) => question.id === store.state.currentQuestionId);
    const voteMap = new Map();
    for (const vote of store.votes) voteMap.set(vote.optionId, (voteMap.get(vote.optionId) || 0) + 1);
    return {
      state: {
        ...store.state,
        currentQuestion: currentQuestion || null
      },
      teams: store.teams,
      questions: [...store.questions].sort((a, b) => (a.order - b.order) || (a.id - b.id)),
      votes: [...voteMap.entries()].map(([option_id, count]) => ({ option_id, count })),
      buzzes: store.buzzes.map((buzz) => ({
        id: buzz.id,
        team_id: buzz.teamId,
        created_at: buzz.createdAt,
        team_name: store.teams.find((team) => team.id === buzz.teamId)?.name || ''
      }))
    };
  }

  const [state] = await query(`
    select gs.*, q.id as question_id, q.play_order, q.round_key as question_round_key,
      q.pool_key as question_pool_key, q.type, q.theme, q.prompt, q.answer,
      q.media_url, q.media_url_b, q.options, q.duration_seconds, q.blur_level
    from game_state gs
    left join questions q on q.id = gs.current_question_id
    where gs.id = 1
  `);
  const teams = await query('select * from teams order by id asc');
  const questions = await query('select * from questions order by play_order asc, id asc');
  const votes = await query('select option_id, count(*)::int as count from votes group by option_id');
  const buzzes = await query(`
    select b.id, b.team_id, b.created_at, t.name as team_name
    from buzzes b
    join teams t on t.id = b.team_id
    order by b.created_at asc
    limit 20
  `);

  return {
    state: {
      phase: state.phase,
      roundKey: state.round_key,
      poolKey: state.pool_key,
      publicMode: state.public_mode,
      revealAnswer: state.reveal_answer,
      timerLabel: state.timer_label,
      timerEndsAt: state.timer_ends_at,
      timerDuration: state.timer_duration,
      timerRunning: state.timer_running,
      buzzLocked: state.buzz_locked,
      buzzWinnerTeamId: state.buzz_winner_team_id,
      voteOpen: state.vote_open,
      voteTitle: state.vote_title,
      voteOptions: state.vote_options || [],
      publicQrVisible: state.public_qr_visible,
      currentQuestion: state.question_id
        ? {
            id: state.question_id,
            order: state.play_order,
            roundKey: state.question_round_key,
            poolKey: state.question_pool_key,
            type: state.type,
            theme: state.theme,
            prompt: state.prompt,
            answer: state.answer,
            mediaUrl: state.media_url,
            mediaUrlB: state.media_url_b,
            options: state.options || [],
            durationSeconds: state.duration_seconds,
            blurLevel: state.blur_level
          }
        : null
    },
    teams: teams.map((team) => ({
      id: team.id,
      code: team.code,
      name: team.name,
      playerOne: team.player_one,
      playerTwo: team.player_two,
      house: team.house,
      score: team.score,
      malus: team.malus,
      qualified: team.qualified,
      eliminated: team.eliminated
    })),
    questions: questions.map((question) => ({
      id: question.id,
      order: question.play_order,
      roundKey: question.round_key,
      poolKey: question.pool_key,
      type: question.type,
      theme: question.theme,
      prompt: question.prompt,
      answer: question.answer,
      mediaUrl: question.media_url,
      mediaUrlB: question.media_url_b,
      options: question.options || [],
      durationSeconds: question.duration_seconds,
      blurLevel: question.blur_level
    })),
    votes,
    buzzes
  };
}

async function broadcast() {
  io.emit('snapshot', await snapshot());
}

async function mutate(res, action) {
  try {
    const result = await action();
    await broadcast();
    res.json(result || { ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: dbReady() });
});

app.get('/api/snapshot', async (_req, res) => {
  res.json(await snapshot());
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  res.json({ ok: true, token: adminPassword });
});

app.patch('/api/teams/:id', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      const team = store.teams.find((item) => item.id === Number(req.params.id));
      if (!team) throw new Error('Equipe introuvable.');
      Object.assign(team, Object.fromEntries(Object.entries(req.body).filter(([, value]) => value !== undefined)));
      return;
    }

    const { name, playerOne, playerTwo, house, score, malus, qualified, eliminated } = req.body;
    await query(
      `update teams set
        name = coalesce($1, name),
        player_one = coalesce($2, player_one),
        player_two = coalesce($3, player_two),
        house = coalesce($4, house),
        score = coalesce($5, score),
        malus = coalesce($6, malus),
        qualified = coalesce($7, qualified),
        eliminated = coalesce($8, eliminated)
       where id = $9`,
      [
        name ?? null,
        playerOne ?? null,
        playerTwo ?? null,
        house ?? null,
        Number.isFinite(Number(score)) ? Number(score) : null,
        Number.isFinite(Number(malus)) ? Number(malus) : null,
        typeof qualified === 'boolean' ? qualified : null,
        typeof eliminated === 'boolean' ? eliminated : null,
        req.params.id
      ]
    );
  });
});

app.post('/api/questions/import', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
    if (!questions.length) throw new Error('Aucune question a importer.');

    if (useMemoryStore()) {
      const store = getMemoryStore();
      for (const item of questions) {
        if (!item.prompt?.trim()) continue;
        store.questions.push({
          id: store.nextQuestionId,
          order: Number(item.order || item.play_order) || store.nextQuestionId,
          roundKey: item.round || item.roundKey || 'round1',
          poolKey: item.pool || item.poolKey || '',
          type: item.type || 'text',
          theme: item.theme || '',
          prompt: item.prompt,
          answer: item.answer || '',
          mediaUrl: item.imageUrl || item.mediaUrl || '',
          mediaUrlB: item.imageUrlB || item.mediaUrlB || '',
          options: [item.optionA, item.optionB, item.optionC, item.optionD].filter(Boolean),
          durationSeconds: Number(item.durationSeconds || item.duration) || 0,
          blurLevel: Number(item.blurLevel) || 14
        });
        store.nextQuestionId += 1;
      }
      return { imported: questions.length };
    }

    for (const item of questions) {
      if (!item.prompt?.trim()) continue;
      await query(
        `insert into questions
          (play_order, round_key, pool_key, type, theme, prompt, answer, media_url, media_url_b, options, duration_seconds, blur_level)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [
          Number(item.order || item.play_order) || 0,
          item.round || item.roundKey || 'round1',
          item.pool || item.poolKey || '',
          item.type || 'text',
          item.theme || '',
          item.prompt,
          item.answer || '',
          item.imageUrl || item.mediaUrl || '',
          item.imageUrlB || item.mediaUrlB || '',
          JSON.stringify([item.optionA, item.optionB, item.optionC, item.optionD].filter(Boolean)),
          Number(item.durationSeconds || item.duration) || 0,
          Number(item.blurLevel) || 14
        ]
      );
    }
    return { imported: questions.length };
  });
});

app.delete('/api/questions', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.questions = [];
      store.state.currentQuestionId = null;
      return;
    }

    await query('delete from questions');
  });
});

app.post('/api/game/state', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      const keys = {
        phase: 'phase',
        roundKey: 'roundKey',
        poolKey: 'poolKey',
        publicMode: 'publicMode',
        currentQuestionId: 'currentQuestionId',
        revealAnswer: 'revealAnswer',
        publicQrVisible: 'publicQrVisible'
      };
      for (const [bodyKey, stateKey] of Object.entries(keys)) {
        if (Object.prototype.hasOwnProperty.call(req.body, bodyKey)) {
          store.state[stateKey] = req.body[bodyKey] || (bodyKey === 'currentQuestionId' ? null : req.body[bodyKey]);
        }
      }
      return;
    }

    const allowed = ['phase', 'roundKey', 'poolKey', 'publicMode', 'currentQuestionId', 'revealAnswer', 'publicQrVisible'];
    const body = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const currentQuestionProvided = Object.prototype.hasOwnProperty.call(body, 'currentQuestionId');

    await query(
      `update game_state set
        phase = coalesce($1, phase),
        round_key = coalesce($2, round_key),
        pool_key = coalesce($3, pool_key),
        public_mode = coalesce($4, public_mode),
        current_question_id = case when $5 then $6 else current_question_id end,
        reveal_answer = coalesce($7, reveal_answer),
        public_qr_visible = coalesce($8, public_qr_visible),
        updated_at = now()
       where id = 1`,
      [
        body.phase ?? null,
        body.roundKey ?? null,
        body.poolKey ?? null,
        body.publicMode ?? null,
        currentQuestionProvided,
        body.currentQuestionId || null,
        typeof body.revealAnswer === 'boolean' ? body.revealAnswer : null,
        typeof body.publicQrVisible === 'boolean' ? body.publicQrVisible : null
      ]
    );
  });
});

app.post('/api/timer/start', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const seconds = Math.max(1, Number(req.body.seconds) || 60);
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.timerLabel = req.body.label || 'Timer';
      store.state.timerDuration = seconds;
      store.state.timerEndsAt = new Date(Date.now() + seconds * 1000).toISOString();
      store.state.timerRunning = true;
      return;
    }

    await query(
      `update game_state set timer_label = $1, timer_duration = $2,
       timer_ends_at = now() + ($2::int * interval '1 second'),
       timer_running = true where id = 1`,
      [req.body.label || 'Timer', seconds]
    );
  });
});

app.post('/api/timer/stop', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.state.timerRunning = false;
      store.state.timerEndsAt = null;
      return;
    }

    await query('update game_state set timer_running = false, timer_ends_at = null where id = 1');
  });
});

app.post('/api/buzzer/reset', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.buzzes = [];
      store.state.buzzLocked = false;
      store.state.buzzWinnerTeamId = null;
      return;
    }

    await query('delete from buzzes');
    await query('update game_state set buzz_locked = false, buzz_winner_team_id = null where id = 1');
  });
});

app.post('/api/buzzer/:teamId', async (req, res) => {
  try {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      if (store.state.buzzLocked) {
        return res.status(409).json({ error: 'Buzzer deja verrouille.' });
      }
      const teamId = Number(req.params.teamId);
      store.buzzes.push({ id: store.nextBuzzId, teamId, createdAt: new Date().toISOString() });
      store.nextBuzzId += 1;
      store.state.buzzLocked = true;
      store.state.buzzWinnerTeamId = teamId;
      await broadcast();
      return res.json({ ok: true });
    }

    const [state] = await query('select buzz_locked from game_state where id = 1');
    if (state.buzz_locked) {
      return res.status(409).json({ error: 'Buzzer deja verrouille.' });
    }

    await query('insert into buzzes (team_id) values ($1)', [req.params.teamId]);
    await query('update game_state set buzz_locked = true, buzz_winner_team_id = $1 where id = 1', [req.params.teamId]);
    await broadcast();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/vote/open', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      store.votes = [];
      store.state.voteOpen = true;
      store.state.voteTitle = req.body.title || 'Vote du public';
      store.state.voteOptions = req.body.options || [];
      store.state.publicQrVisible = Boolean(req.body.publicQrVisible);
      return;
    }

    await query('delete from votes');
    await query(
      'update game_state set vote_open = true, vote_title = $1, vote_options = $2::jsonb, public_qr_visible = $3 where id = 1',
      [req.body.title || 'Vote du public', JSON.stringify(req.body.options || []), Boolean(req.body.publicQrVisible)]
    );
  });
});

app.post('/api/vote/close', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      getMemoryStore().state.voteOpen = false;
      return;
    }

    await query('update game_state set vote_open = false where id = 1');
  });
});

app.post('/api/vote', async (req, res) => {
  try {
    const id = deviceId(req);
    const { optionId } = req.body;
    if (!optionId) throw new Error('Vote invalide.');
    if (useMemoryStore()) {
      const store = getMemoryStore();
      if (!store.votes.some((vote) => vote.deviceId === id)) {
        store.votes.push({ deviceId: id, optionId });
      }
      await broadcast();
      return res.json({ ok: true, deviceId: id });
    }

    await query('insert into votes (device_id, option_id) values ($1, $2) on conflict (device_id) do nothing', [id, optionId]);
    await broadcast();
    res.json({ ok: true, deviceId: id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/reset', requireAdmin, (req, res) => {
  mutate(res, async () => {
    if (useMemoryStore()) {
      const store = getMemoryStore();
      for (const team of store.teams) {
        team.score = 0;
        team.malus = 0;
        team.qualified = false;
        team.eliminated = false;
      }
      store.buzzes = [];
      store.votes = [];
      store.state = {
        ...store.state,
        phase: 'welcome',
        roundKey: 'welcome',
        poolKey: '',
        currentQuestionId: null,
        revealAnswer: false,
        publicMode: 'welcome',
        timerLabel: '',
        timerEndsAt: null,
        timerRunning: false,
        buzzLocked: false,
        buzzWinnerTeamId: null,
        voteOpen: false,
        voteTitle: '',
        voteOptions: [],
        publicQrVisible: false
      };
      return;
    }

    await query('update teams set score = 0, malus = 0, qualified = false, eliminated = false');
    await query('delete from buzzes');
    await query('delete from votes');
    await query(`update game_state set phase='welcome', round_key='welcome', pool_key='', current_question_id=null,
      reveal_answer=false, public_mode='welcome', timer_label='', timer_ends_at=null, timer_running=false,
      buzz_locked=false, buzz_winner_team_id=null, vote_open=false, vote_title='', vote_options='[]'::jsonb,
      public_qr_visible=false where id=1`);
  });
});

io.on('connection', async (socket) => {
  socket.emit('snapshot', await snapshot());
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

initDatabase()
  .then(() => {
    server.listen(port, () => console.log(`LISAA Live Quiz listening on ${port}`));
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
