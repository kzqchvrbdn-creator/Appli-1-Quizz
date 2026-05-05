import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hasDatabase, initDatabase, query } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'lisaa';
const clients = new Set();

app.use(express.json({ limit: '2mb' }));

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  const expected = crypto.createHash('sha256').update(adminPassword).digest('hex');
  const received = crypto.createHash('sha256').update(token).digest('hex');

  if (expected !== received) {
    return res.status(401).json({ error: 'Mot de passe admin incorrect.' });
  }

  next();
}

function sendEvent(payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

async function getSnapshot() {
  const [state] = await query(`
    select
      gs.*,
      q.id as question_id,
      q.theme,
      q.type,
      q.prompt,
      q.answer,
      q.media_url,
      q.options,
      q.blur_level
    from game_state gs
    left join questions q on q.id = gs.current_question_id
    where gs.id = 1
  `);

  const teams = await query('select * from teams order by eliminated asc, malus asc, score desc, id asc');
  const questions = await query('select * from questions order by id desc');

  return {
    state: {
      id: state.id,
      status: state.status,
      roundNumber: state.round_number,
      revealAnswer: state.reveal_answer,
      currentQuestion: state.question_id
        ? {
            id: state.question_id,
            theme: state.theme,
            type: state.type,
            prompt: state.prompt,
            answer: state.answer,
            mediaUrl: state.media_url,
            options: state.options || [],
            blurLevel: state.blur_level
          }
        : null
    },
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      playerOne: team.player_one,
      playerTwo: team.player_two,
      score: team.score,
      malus: team.malus,
      eliminated: team.eliminated
    })),
    questions: questions.map((question) => ({
      id: question.id,
      theme: question.theme,
      type: question.type,
      prompt: question.prompt,
      answer: question.answer,
      mediaUrl: question.media_url,
      options: question.options || [],
      blurLevel: question.blur_level
    }))
  };
}

async function mutate(res, action) {
  try {
    const result = await action();
    sendEvent({ type: 'snapshot', snapshot: await getSnapshot() });
    res.json(result || { ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: hasDatabase() });
});

app.get('/api/snapshot', async (_req, res) => {
  try {
    res.json(await getSnapshot());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/events', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  clients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== adminPassword) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  res.json({ ok: true, token: adminPassword });
});

app.post('/api/teams', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const { name, playerOne = '', playerTwo = '' } = req.body;
    if (!name?.trim()) throw new Error("Le nom de l'equipe est obligatoire.");

    const [team] = await query(
      'insert into teams (name, player_one, player_two) values ($1, $2, $3) returning *',
      [name.trim(), playerOne.trim(), playerTwo.trim()]
    );
    return team;
  });
});

app.patch('/api/teams/:id', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const { score, malus, eliminated } = req.body;
    const nextMalus = Number.isFinite(Number(malus)) ? Number(malus) : 0;
    const autoEliminated = typeof eliminated === 'boolean' ? eliminated : nextMalus >= 2;

    await query(
      'update teams set score = $1, malus = $2, eliminated = $3 where id = $4',
      [Number(score) || 0, nextMalus, autoEliminated, req.params.id]
    );
    return { ok: true };
  });
});

app.delete('/api/teams/:id', requireAdmin, (req, res) => {
  mutate(res, async () => {
    await query('delete from teams where id = $1', [req.params.id]);
    return { ok: true };
  });
});

app.post('/api/questions', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const { theme = '', type = 'text', prompt, answer = '', mediaUrl = '', options = [], blurLevel = 12 } = req.body;
    if (!prompt?.trim()) throw new Error('La question est obligatoire.');

    const [question] = await query(
      `insert into questions (theme, type, prompt, answer, media_url, options, blur_level)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)
       returning *`,
      [
        theme.trim(),
        type,
        prompt.trim(),
        answer.trim(),
        mediaUrl.trim(),
        JSON.stringify(Array.isArray(options) ? options.filter(Boolean) : []),
        Number(blurLevel) || 0
      ]
    );
    return question;
  });
});

app.delete('/api/questions/:id', requireAdmin, (req, res) => {
  mutate(res, async () => {
    await query('delete from questions where id = $1', [req.params.id]);
    return { ok: true };
  });
});

app.post('/api/game', requireAdmin, (req, res) => {
  mutate(res, async () => {
    const { status, roundNumber, currentQuestionId, revealAnswer } = req.body;
    const shouldUpdateQuestion = Object.prototype.hasOwnProperty.call(req.body, 'currentQuestionId');
    await query(
      `update game_state
       set status = coalesce($1, status),
           round_number = coalesce($2, round_number),
           current_question_id = case when $3 then $4 else current_question_id end,
           reveal_answer = coalesce($5, reveal_answer),
           updated_at = now()
       where id = 1`,
      [
        status ?? null,
        Number.isFinite(Number(roundNumber)) ? Number(roundNumber) : null,
        shouldUpdateQuestion,
        currentQuestionId || null,
        typeof revealAnswer === 'boolean' ? revealAnswer : null
      ]
    );
    return { ok: true };
  });
});

app.post('/api/game/reset', requireAdmin, (req, res) => {
  mutate(res, async () => {
    await query('update teams set score = 0, malus = 0, eliminated = false');
    await query("update game_state set status = 'lobby', round_number = 1, current_question_id = null, reveal_answer = false where id = 1");
    return { ok: true };
  });
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Duo Quiz listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
