import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Eye,
  EyeOff,
  Image,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  ScreenShare,
  Send,
  Shield,
  Trophy,
  Users,
  X
} from 'lucide-react';
import './styles.css';

const emptySnapshot = {
  state: { status: 'lobby', roundNumber: 1, revealAnswer: false, currentQuestion: null },
  teams: [],
  questions: []
};

function authHeader() {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Action impossible.');
  return data;
}

function useGame() {
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
    const events = new EventSource('/events');
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.snapshot) setSnapshot(payload.snapshot);
    };
    events.onerror = () => setError('Connexion temps reel interrompue.');
    return () => events.close();
  }, []);

  return { snapshot, error, refresh };
}

function TeamBoard({ teams, compact = false }) {
  const activeTeams = teams.filter((team) => !team.eliminated);
  const eliminatedTeams = teams.filter((team) => team.eliminated);

  return (
    <section className={compact ? 'scoreboard compact' : 'scoreboard'}>
      <div className="section-title">
        <Trophy size={18} />
        <h2>Classement</h2>
      </div>
      <div className="teams-grid">
        {[...activeTeams, ...eliminatedTeams].map((team) => (
          <article className={`team-card ${team.eliminated ? 'is-out' : ''}`} key={team.id}>
            <div>
              <strong>{team.name}</strong>
              <span>{[team.playerOne, team.playerTwo].filter(Boolean).join(' + ') || 'Duo'}</span>
            </div>
            <div className="team-stats">
              <b>{team.score}</b>
              <small>score</small>
              <b>{team.malus}/2</b>
              <small>malus</small>
            </div>
            {team.eliminated && <span className="badge danger">Elimine</span>}
          </article>
        ))}
        {!teams.length && <p className="muted">Les equipes apparaitront ici.</p>}
      </div>
    </section>
  );
}

function QuestionView({ state, screen = false }) {
  const question = state.currentQuestion;

  return (
    <section className={screen ? 'question-panel screen-question' : 'question-panel'}>
      <div className="round-line">
        <span>Manche {state.roundNumber}</span>
        <span>{state.status === 'live' ? 'En cours' : state.status === 'ended' ? 'Termine' : 'En attente'}</span>
      </div>
      {!question ? (
        <div className="empty-question">
          <ScreenShare size={34} />
          <h1>En attente de la prochaine question</h1>
        </div>
      ) : (
        <>
          <div className="question-heading">
            <span className="badge">{question.theme || 'Question'}</span>
            <span className="badge light">{question.type === 'image' ? 'Photo floutee' : 'Question simple'}</span>
          </div>
          <h1>{question.prompt}</h1>
          {question.mediaUrl && (
            <img
              className="question-image"
              src={question.mediaUrl}
              alt=""
              style={{ filter: state.revealAnswer ? 'none' : `blur(${question.blurLevel}px)` }}
            />
          )}
          {!!question.options?.length && (
            <div className="options-grid">
              {question.options.map((option) => (
                <span key={option}>{option}</span>
              ))}
            </div>
          )}
          <div className={`answer-box ${state.revealAnswer ? 'is-visible' : ''}`}>
            {state.revealAnswer ? question.answer || 'Reponse non renseignee' : 'Reponse masquee'}
          </div>
        </>
      )}
    </section>
  );
}

function PublicApp({ snapshot, error }) {
  return (
    <main className="app-shell public-shell">
      <nav>
        <div className="brand">
          <Users size={22} />
          <span>Duo Quiz</span>
        </div>
        <a href="/admin">Admin</a>
      </nav>
      {error && <p className="error">{error}</p>}
      <QuestionView state={snapshot.state} />
      <TeamBoard teams={snapshot.teams} />
    </main>
  );
}

function ScreenApp({ snapshot }) {
  return (
    <main className="screen-shell">
      <QuestionView state={snapshot.state} screen />
      <TeamBoard teams={snapshot.teams} compact />
    </main>
  );
}

function AdminApp({ snapshot, error, refresh }) {
  const [password, setPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem('adminToken')));
  const [team, setTeam] = useState({ name: '', playerOne: '', playerTwo: '' });
  const [question, setQuestion] = useState({
    theme: '',
    type: 'text',
    prompt: '',
    answer: '',
    mediaUrl: '',
    optionsText: '',
    blurLevel: 12
  });
  async function login(event) {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      localStorage.setItem('adminToken', result.token);
      setLoggedIn(true);
      setAdminError('');
      setPassword('');
      refresh();
    } catch (err) {
      setAdminError(err.message);
    }
  }

  async function addTeam(event) {
    event.preventDefault();
    await api('/api/teams', { method: 'POST', body: JSON.stringify(team) });
    setTeam({ name: '', playerOne: '', playerTwo: '' });
  }

  async function addQuestion(event) {
    event.preventDefault();
    await api('/api/questions', {
      method: 'POST',
      body: JSON.stringify({
        ...question,
        options: question.optionsText.split('\n').map((item) => item.trim()).filter(Boolean)
      })
    });
    setQuestion({ theme: '', type: 'text', prompt: '', answer: '', mediaUrl: '', optionsText: '', blurLevel: 12 });
  }

  async function updateTeam(teamToUpdate, changes) {
    await api(`/api/teams/${teamToUpdate.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...teamToUpdate, ...changes })
    });
  }

  async function setQuestionLive(questionId) {
    await api('/api/game', {
      method: 'POST',
      body: JSON.stringify({ status: 'live', currentQuestionId: questionId, revealAnswer: false })
    });
  }

  if (!loggedIn) {
    return (
      <main className="admin-login">
        <form onSubmit={login} className="login-card">
          <Lock size={30} />
          <h1>Acces admin</h1>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Mot de passe" />
          <button type="submit">
            <Shield size={18} />
            Entrer
          </button>
          {(adminError || error) && <p className="error">{adminError || error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell admin-shell">
      <nav>
        <div className="brand">
          <Shield size={22} />
          <span>Admin Duo Quiz</span>
        </div>
        <div className="nav-actions">
          <a href="/">Public</a>
          <a href="/screen">Ecran</a>
          <button className="ghost" onClick={() => {
            localStorage.removeItem('adminToken');
            setLoggedIn(false);
          }}>Deconnexion</button>
        </div>
      </nav>

      {(error || adminError) && <p className="error">{adminError || error}</p>}

      <div className="admin-grid">
        <section className="panel">
          <div className="section-title">
            <Send size={18} />
            <h2>Controle de la manche</h2>
          </div>
          <div className="control-row">
            <button onClick={() => api('/api/game', { method: 'POST', body: JSON.stringify({ status: 'live' }) })}>Lancer</button>
            <button onClick={() => api('/api/game', { method: 'POST', body: JSON.stringify({ revealAnswer: !snapshot.state.revealAnswer }) })}>
              {snapshot.state.revealAnswer ? <EyeOff size={17} /> : <Eye size={17} />}
              {snapshot.state.revealAnswer ? 'Masquer' : 'Reveler'}
            </button>
            <button onClick={() => api('/api/game', { method: 'POST', body: JSON.stringify({ roundNumber: snapshot.state.roundNumber + 1, revealAnswer: false }) })}>
              Manche +1
            </button>
            <button className="danger-button" onClick={() => api('/api/game/reset', { method: 'POST' })}>
              <RotateCcw size={17} />
              Reset
            </button>
          </div>
          <QuestionView state={snapshot.state} />
        </section>

        <section className="panel">
          <div className="section-title">
            <Users size={18} />
            <h2>Equipes</h2>
          </div>
          <form className="stack-form" onSubmit={addTeam}>
            <input placeholder="Nom de l'equipe" value={team.name} onChange={(event) => setTeam({ ...team, name: event.target.value })} />
            <input placeholder="Joueur 1" value={team.playerOne} onChange={(event) => setTeam({ ...team, playerOne: event.target.value })} />
            <input placeholder="Joueur 2" value={team.playerTwo} onChange={(event) => setTeam({ ...team, playerTwo: event.target.value })} />
            <button type="submit">
              <Plus size={17} />
              Ajouter
            </button>
          </form>

          <div className="admin-team-list">
            {snapshot.teams.map((item) => (
              <article className={item.eliminated ? 'admin-team is-out' : 'admin-team'} key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{[item.playerOne, item.playerTwo].filter(Boolean).join(' + ') || 'Duo'}</span>
                </div>
                <div className="stepper">
                  <button title="Retirer un score" onClick={() => updateTeam(item, { score: item.score - 1 })}><Minus size={15} /></button>
                  <b>{item.score}</b>
                  <button title="Ajouter un score" onClick={() => updateTeam(item, { score: item.score + 1 })}><Plus size={15} /></button>
                </div>
                <div className="stepper malus">
                  <button title="Retirer un malus" onClick={() => updateTeam(item, { malus: Math.max(0, item.malus - 1), eliminated: false })}><Minus size={15} /></button>
                  <b>{item.malus}/2</b>
                  <button title="Ajouter un malus" onClick={() => updateTeam(item, { malus: item.malus + 1 })}><Plus size={15} /></button>
                </div>
                <button className="icon-danger" title="Supprimer" onClick={() => api(`/api/teams/${item.id}`, { method: 'DELETE' })}><X size={16} /></button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel wide">
          <div className="section-title">
            <Image size={18} />
            <h2>Questions</h2>
          </div>
          <form className="question-form" onSubmit={addQuestion}>
            <input placeholder="Theme" value={question.theme} onChange={(event) => setQuestion({ ...question, theme: event.target.value })} />
            <select value={question.type} onChange={(event) => setQuestion({ ...question, type: event.target.value })}>
              <option value="text">Question simple</option>
              <option value="image">Photo floutee</option>
            </select>
            <textarea placeholder="Question" value={question.prompt} onChange={(event) => setQuestion({ ...question, prompt: event.target.value })} />
            <input placeholder="Reponse" value={question.answer} onChange={(event) => setQuestion({ ...question, answer: event.target.value })} />
            <input placeholder="URL image si besoin" value={question.mediaUrl} onChange={(event) => setQuestion({ ...question, mediaUrl: event.target.value })} />
            <textarea placeholder="Choix possibles, un par ligne" value={question.optionsText} onChange={(event) => setQuestion({ ...question, optionsText: event.target.value })} />
            <label className="range-line">
              Flou
              <input type="range" min="0" max="30" value={question.blurLevel} onChange={(event) => setQuestion({ ...question, blurLevel: event.target.value })} />
              {question.blurLevel}px
            </label>
            <button type="submit">
              <Plus size={17} />
              Ajouter la question
            </button>
          </form>

          <div className="question-list">
            {snapshot.questions.map((item) => (
              <article key={item.id} className="question-item">
                <div>
                  <span className="badge light">{item.theme || item.type}</span>
                  <strong>{item.prompt}</strong>
                  <small>{item.answer}</small>
                </div>
                <button onClick={() => setQuestionLive(item.id)}>Afficher</button>
                <button className="icon-danger" onClick={() => api(`/api/questions/${item.id}`, { method: 'DELETE' })}><X size={16} /></button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function App() {
  const { snapshot, error, refresh } = useGame();
  const path = window.location.pathname;

  return useMemo(() => {
    if (path === '/admin') return <AdminApp snapshot={snapshot} error={error} refresh={refresh} />;
    if (path === '/screen') return <ScreenApp snapshot={snapshot} />;
    return <PublicApp snapshot={snapshot} error={error} />;
  }, [path, snapshot, error]);
}

createRoot(document.getElementById('root')).render(<App />);
