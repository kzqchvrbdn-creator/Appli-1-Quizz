import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import Papa from 'papaparse';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlarmClock,
  Check,
  Eye,
  EyeOff,
  FileUp,
  Flag,
  Image as ImageIcon,
  Lock,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Shield,
  Sparkles,
  TimerReset,
  Trophy,
  Users,
  Vote,
  X
} from 'lucide-react';
import './styles.css';

const rounds = [
  { key: 'welcome', label: 'Accueil' },
  { key: 'round1', label: 'Manche 1 - Vrai / Faux' },
  { key: 'stroop', label: 'Mini-jeu Stroop' },
  { key: 'round2', label: 'Manche 2 - Chaine' },
  { key: 'drawing', label: 'Mini-jeu vote' },
  { key: 'round3', label: 'Manche 3 - BuzzUp' },
  { key: 'dragon', label: 'Le Dragon' },
  { key: 'final', label: 'Finale' }
];

const emptySnapshot = {
  state: { publicMode: 'welcome', roundKey: 'welcome', revealAnswer: false, voteOptions: [], publicQrVisible: false, currentQuestion: null },
  teams: [],
  questions: [],
  votes: [],
  buzzes: []
};

function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

function headers() {
  const token = localStorage.getItem('adminToken');
  return {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...headers(), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Action impossible.');
  return data;
}

function useLive() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      setSnapshot(await api('/api/snapshot'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const socket = io();
    socket.on('snapshot', setSnapshot);
    socket.on('connect_error', () => setError('Temps reel indisponible.'));
    return () => socket.close();
  }, []);

  return { snapshot, error, refresh };
}

function remainingSeconds(state) {
  if (!state.timerRunning || !state.timerEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(state.timerEndsAt).getTime() - Date.now()) / 1000));
}

function TimerDisplay({ state }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(id);
  }, []);
  const seconds = remainingSeconds(state) + tick * 0;
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return (
    <div className="timer-display">
      <AlarmClock size={22} />
      <span>{state.timerLabel || 'Timer'}</span>
      <strong>{minutes}:{rest}</strong>
    </div>
  );
}

function QuestionStage({ state }) {
  const question = state.currentQuestion;
  if (!question) {
    return (
      <section className="stage-card empty-stage">
        <Sparkles size={44} />
        <h1>LISAA Live Quiz</h1>
        <p>La regie prepare la prochaine sequence.</p>
      </section>
    );
  }

  return (
    <section className={`stage-card question-stage type-${question.type}`}>
      <div className="stage-meta">
        <span>{rounds.find((round) => round.key === question.roundKey)?.label || question.roundKey}</span>
        <span>#{question.order || question.id}</span>
        <span>{question.theme || question.type}</span>
      </div>
      <h1>{question.prompt}</h1>
      {(question.mediaUrl || question.mediaUrlB) && (
        <div className={question.mediaUrlB ? 'media-compare' : 'media-single'}>
          {question.mediaUrl && (
            <img
              src={question.mediaUrl}
              alt=""
              style={{
                filter: question.type === 'blur' && !state.revealAnswer ? `blur(${question.blurLevel}px)` : 'none',
                transform: question.type === 'zoom' && !state.revealAnswer ? 'scale(1.65)' : 'scale(1)'
              }}
            />
          )}
          {question.mediaUrlB && <img src={question.mediaUrlB} alt="" />}
        </div>
      )}
      {!!question.options?.length && (
        <div className="answer-options">
          {question.options.map((option) => <span key={option}>{option}</span>)}
        </div>
      )}
      <div className={`answer-reveal ${state.revealAnswer ? 'visible' : ''}`}>
        {state.revealAnswer ? question.answer || 'Reponse libre' : 'Reponse masquee'}
      </div>
    </section>
  );
}

function Scoreboard({ teams }) {
  return (
    <section className="scoreboard">
      <div className="section-title"><Trophy size={18} /><h2>Equipes</h2></div>
      <div className="team-grid">
        {teams.map((team) => (
          <article className={`team-card ${team.eliminated ? 'out' : ''} ${team.qualified ? 'qualified' : ''}`} key={team.id}>
            <div>
              <strong>{team.name}</strong>
              <span>{[team.playerOne, team.playerTwo].filter(Boolean).join(' + ') || 'Binome'}</span>
            </div>
            <div className="score-line">
              <b>{team.score}</b><small>pts</small>
              <b>{team.malus}</b><small>malus</small>
            </div>
            {team.qualified && <em>Qualifiee</em>}
            {team.eliminated && <em>Eliminee</em>}
          </article>
        ))}
      </div>
    </section>
  );
}

function VoteResults({ snapshot }) {
  const total = snapshot.votes.reduce((sum, vote) => sum + vote.count, 0);
  if (!snapshot.state.voteOptions?.length) return null;
  return (
    <section className="vote-results">
      <h2>{snapshot.state.voteTitle || 'Vote du public'}</h2>
      {snapshot.state.voteOptions.map((option) => {
        const count = snapshot.votes.find((vote) => vote.option_id === option.id)?.count || 0;
        const percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <div className="vote-bar" key={option.id}>
            <span>{option.label}</span>
            <div><i style={{ width: `${percent}%` }} /></div>
            <b>{percent}%</b>
          </div>
        );
      })}
    </section>
  );
}

function PublicScreen({ snapshot }) {
  const winner = snapshot.teams.find((team) => team.id === snapshot.state.buzzWinnerTeamId);
  const origin = window.location.origin;
  const showVotePanel = snapshot.state.publicMode === 'vote';
  const showVoteQr = showVotePanel && snapshot.state.publicQrVisible;

  return (
    <main className="screen-layout">
      <header className="screen-header">
        <div className="brand-mark">LISAA</div>
        <TimerDisplay state={snapshot.state} />
      </header>
      <QuestionStage state={snapshot.state} />
      {winner && <div className="buzz-banner"><Radio size={26} /> {winner.name} a buzze en premier</div>}
      {showVotePanel && (
        <div className={`vote-public-zone ${showVoteQr ? '' : 'results-only'}`}>
          {showVoteQr && (
            <div className="public-qr-card">
              <QRCodeSVG value={`${origin}/vote`} size={128} />
              <span>Vote public</span>
            </div>
          )}
          <VoteResults snapshot={snapshot} />
        </div>
      )}
      <Scoreboard teams={snapshot.teams} />
    </main>
  );
}

function Login({ refresh }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      localStorage.setItem('adminToken', result.token);
      refresh();
      window.location.reload();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <main className="admin-login">
      <form className="login-card" onSubmit={submit}>
        <Lock size={30} />
        <h1>Regie admin</h1>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" />
        <button><Shield size={17} /> Entrer</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function Admin({ snapshot, refresh, error }) {
  const [csvStatus, setCsvStatus] = useState('');
  const [voteTitle, setVoteTitle] = useState('Quel dessin est le plus proche ?');
  const [voteA, setVoteA] = useState('Equipe A');
  const [voteB, setVoteB] = useState('Equipe B');
  const logged = Boolean(localStorage.getItem('adminToken'));

  if (!logged) return <Login refresh={refresh} />;

  async function importCsv(file) {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        await api('/api/questions/import', { method: 'POST', body: JSON.stringify({ questions: result.data }) });
        setCsvStatus(`${result.data.length} lignes importees`);
      }
    });
  }

  async function patchTeam(team, patch) {
    await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  const currentRoundQuestions = snapshot.questions.filter((question) => question.roundKey === snapshot.state.roundKey);

  return (
    <main className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand"><Sparkles size={22} /> LISAA Quiz</div>
        {rounds.map((round) => (
          <button
            key={round.key}
            className={snapshot.state.roundKey === round.key ? 'active' : ''}
            onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ roundKey: round.key, phase: round.key, publicMode: round.key === 'drawing' ? 'vote' : 'question' }) })}
          >
            {round.label}
          </button>
        ))}
        <button className="danger" onClick={() => api('/api/reset', { method: 'POST' })}><RotateCcw size={16} /> Reset jeu</button>
      </aside>

      <section className="admin-main">
        {error && <p className="error">{error}</p>}
        <div className="admin-toolbar">
          <h1>Regie live</h1>
          <a href="/screen" target="_blank">Ecran public</a>
        </div>

        <div className="admin-panels">
          <section className="admin-panel wide">
            <div className="section-title"><Flag size={18} /><h2>Question active</h2></div>
            <QuestionStage state={snapshot.state} />
            <div className="button-row">
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ revealAnswer: !snapshot.state.revealAnswer }) })}>
                {snapshot.state.revealAnswer ? <EyeOff size={17} /> : <Eye size={17} />}
                {snapshot.state.revealAnswer ? 'Masquer' : 'Reveler'}
              </button>
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ currentQuestionId: null, revealAnswer: false }) })}>Vider ecran</button>
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ publicQrVisible: !snapshot.state.publicQrVisible }) })}>
                {snapshot.state.publicQrVisible ? 'Masquer QR public' : 'Afficher QR public'}
              </button>
            </div>
          </section>

          <section className="admin-panel">
            <div className="section-title"><FileUp size={18} /><h2>Import CSV</h2></div>
            <label className="file-button">
              Importer questions
              <input type="file" accept=".csv" onChange={(event) => importCsv(event.target.files?.[0])} />
            </label>
            <code>order,round,pool,type,theme,prompt,answer,imageUrl,imageUrlB,optionA,optionB,optionC,optionD,durationSeconds,blurLevel</code>
            {csvStatus && <p className="success">{csvStatus}</p>}
            <button className="danger" onClick={() => api('/api/questions', { method: 'DELETE' })}>Supprimer les questions</button>
          </section>

          <section className="admin-panel">
            <div className="section-title"><AlarmClock size={18} /><h2>Timer</h2></div>
            <div className="timer-presets">
              {[60, 300, 600, 900].map((seconds) => (
                <button key={seconds} onClick={() => api('/api/timer/start', { method: 'POST', body: JSON.stringify({ seconds, label: `${seconds / 60} min` }) })}>{seconds / 60} min</button>
              ))}
              <button onClick={() => api('/api/timer/stop', { method: 'POST' })}><TimerReset size={16} /> Stop</button>
            </div>
            <TimerDisplay state={snapshot.state} />
          </section>

          <section className="admin-panel">
            <div className="section-title"><Radio size={18} /><h2>Buzzer</h2></div>
            <div className="qr-grid">
              {snapshot.teams.slice(0, 2).map((team) => (
                <div className="qr-card" key={team.id}>
                  <QRCodeSVG value={`${window.location.origin}/buzzer/${team.id}`} size={100} />
                  <strong>{team.name}</strong>
                </div>
              ))}
            </div>
            <button onClick={() => api('/api/buzzer/reset', { method: 'POST' })}>Debloquer buzzers</button>
            {snapshot.buzzes[0] && <p className="success">Premier buzz : {snapshot.buzzes[0].team_name}</p>}
          </section>

          <section className="admin-panel">
            <div className="section-title"><Vote size={18} /><h2>Vote public</h2></div>
            <input value={voteTitle} onChange={(event) => setVoteTitle(event.target.value)} />
            <input value={voteA} onChange={(event) => setVoteA(event.target.value)} />
            <input value={voteB} onChange={(event) => setVoteB(event.target.value)} />
            <div className="button-row">
              <button onClick={() => api('/api/vote/open', { method: 'POST', body: JSON.stringify({ title: voteTitle, options: [{ id: 'a', label: voteA }, { id: 'b', label: voteB }], publicQrVisible: false }) })}>Ouvrir vote</button>
              <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ publicMode: 'vote', publicQrVisible: true }) })}>Afficher QR</button>
              <button onClick={() => api('/api/vote/close', { method: 'POST' })}>Fermer</button>
            </div>
            <QRCodeSVG value={`${window.location.origin}/vote`} size={112} />
            <VoteResults snapshot={snapshot} />
          </section>

          <section className="admin-panel wide">
            <div className="section-title"><Users size={18} /><h2>Equipes</h2></div>
            <div className="admin-team-grid">
              {snapshot.teams.map((team) => (
                <article className="admin-team" key={team.id}>
                  <input value={team.name} onChange={(event) => patchTeam(team, { name: event.target.value })} />
                  <input placeholder="Joueur 1" value={team.playerOne} onChange={(event) => patchTeam(team, { playerOne: event.target.value })} />
                  <input placeholder="Joueur 2" value={team.playerTwo} onChange={(event) => patchTeam(team, { playerTwo: event.target.value })} />
                  <div className="stepper"><button onClick={() => patchTeam(team, { score: team.score - 1 })}><Minus size={14} /></button><b>{team.score}</b><button onClick={() => patchTeam(team, { score: team.score + 1 })}><Plus size={14} /></button></div>
                  <div className="stepper malus"><button onClick={() => patchTeam(team, { malus: Math.max(0, team.malus - 1), eliminated: false })}><Minus size={14} /></button><b>{team.malus}</b><button onClick={() => patchTeam(team, { malus: team.malus + 1, eliminated: team.malus + 1 >= 2 })}><Plus size={14} /></button></div>
                  <button onClick={() => patchTeam(team, { qualified: !team.qualified })}><Check size={15} /> Qualifie</button>
                  <button className="danger" onClick={() => patchTeam(team, { eliminated: !team.eliminated })}><X size={15} /> Elimine</button>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-panel wide">
            <div className="section-title"><ImageIcon size={18} /><h2>Questions de la manche</h2></div>
            <div className="question-table">
              {currentRoundQuestions.map((question) => (
                <article key={question.id}>
                  <span>#{question.order}</span>
                  <strong>{question.prompt}</strong>
                  <small>{question.type} | {question.theme}</small>
                  <button onClick={() => api('/api/game/state', { method: 'POST', body: JSON.stringify({ currentQuestionId: question.id, revealAnswer: false, publicMode: 'question' }) })}>Afficher</button>
                </article>
              ))}
              {!currentRoundQuestions.length && <p className="muted">Importe un CSV pour remplir cette manche.</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Buzzer({ snapshot }) {
  const teamId = Number(window.location.pathname.split('/').pop());
  const team = snapshot.teams.find((item) => item.id === teamId);
  const [message, setMessage] = useState('');
  async function buzz() {
    try {
      await api(`/api/buzzer/${teamId}`, { method: 'POST' });
      setMessage('Buzz envoye');
    } catch (err) {
      setMessage(err.message);
    }
  }
  return (
    <main className="phone-page buzzer-page">
      <h1>{team?.name || 'Buzzer'}</h1>
      <button disabled={snapshot.state.buzzLocked} onClick={buzz}>BUZZ</button>
      <p>{snapshot.state.buzzLocked ? 'Buzzer verrouille' : message || 'Pret'}</p>
    </main>
  );
}

function VotePage({ snapshot }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  async function vote(optionId) {
    try {
      await api('/api/vote', { method: 'POST', body: JSON.stringify({ optionId }) });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <main className="phone-page vote-page">
      <h1>{snapshot.state.voteTitle || 'Vote du public'}</h1>
      {!snapshot.state.voteOpen && <p>Le vote est ferme.</p>}
      {snapshot.state.voteOpen && !done && snapshot.state.voteOptions.map((option) => (
        <button key={option.id} onClick={() => vote(option.id)}>{option.label}</button>
      ))}
      {done && <p>Vote enregistre, merci.</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function App() {
  const { snapshot, error, refresh } = useLive();
  const path = window.location.pathname;
  return useMemo(() => {
    if (path.startsWith('/admin')) return <Admin snapshot={snapshot} refresh={refresh} error={error} />;
    if (path.startsWith('/screen')) return <PublicScreen snapshot={snapshot} />;
    if (path.startsWith('/buzzer/')) return <Buzzer snapshot={snapshot} />;
    if (path.startsWith('/vote')) return <VotePage snapshot={snapshot} />;
    return <PublicScreen snapshot={snapshot} />;
  }, [path, snapshot, error]);
}

createRoot(document.getElementById('root')).render(<App />);
