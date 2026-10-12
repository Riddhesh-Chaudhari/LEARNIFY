/* ============================================================
   LEARNIFY — English Learning App
   app.js  — Main application logic + Gemini AI integration
   ============================================================ */

/* ============================================================
   GEMINI AI MODULE
   ============================================================ */
const GeminiAI = {
  getKey() {
    return localStorage.getItem('learnify_api_key') || '';
  },

  async call(prompt, jsonMode = false) {
    const key = this.getKey();
    if (!key) throw new Error('NO_API_KEY');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: jsonMode
        ? { responseMimeType: 'application/json', temperature: 0.7 }
        : { temperature: 0.8 }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (jsonMode) {
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
      } catch {
        throw new Error('AI returned invalid JSON. Please try again.');
      }
    }
    return text;
  }
};

/* ============================================================
   STORAGE / STATE
   ============================================================ */
const Store = {
  get(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem('learnify_' + key)) ?? fallback; } catch { return fallback; }
  },
  set(key, val) { localStorage.setItem('learnify_' + key, JSON.stringify(val)); },

  getStats() {
    return this.get('stats', { xp: 0, streak: 0, lastDate: null, totalQuizzes: 0, correct: 0, wrong: 0, vocabCorrect: 0, vocabTotal: 0, grammarCorrect: 0, grammarTotal: 0, speakingDone: 0 });
  },
  saveStats(s) { this.set('stats', s); },

  getWordBook() { return this.get('wordbook', []); },
  addWords(words) {
    const wb = this.getWordBook();
    words.forEach(w => {
      if (!wb.find(x => x.word.toLowerCase() === w.word.toLowerCase())) wb.push(w);
    });
    this.set('wordbook', wb);
  },
  clearWordBook() { this.set('wordbook', []); },

  getActivity() { return this.get('activity', []); },
  addActivity(item) {
    const a = this.getActivity();
    a.unshift({ ...item, time: new Date().toISOString() });
    if (a.length > 30) a.pop();
    this.set('activity', a);
  },

  addXP(amount) {
    const s = this.getStats();
    s.xp += amount;
    // streak
    const today = new Date().toDateString();
    if (s.lastDate !== today) { s.streak = (s.lastDate === new Date(Date.now() - 86400000).toDateString()) ? s.streak + 1 : 1; s.lastDate = today; }
    this.saveStats(s);
    return s.xp;
  }
};

/* ============================================================
   LEVEL SYSTEM
   ============================================================ */
const Levels = [
  { name: 'Beginner',     minXP: 0   },
  { name: 'Elementary',   minXP: 500 },
  { name: 'Pre-Intermediate', minXP: 1200 },
  { name: 'Intermediate', minXP: 2500 }
];

function getCurrentLevel(xp) {
  for (let i = Levels.length - 1; i >= 0; i--) {
    if (xp >= Levels[i].minXP) return i;
  }
  return 0;
}

function getNextLevel(xp) {
  const idx = getCurrentLevel(xp);
  return Levels[idx + 1] || null;
}

/* ============================================================
   ROUTER / NAVIGATION
   ============================================================ */
const Router = {
  current: 'home',
  go(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.add('active');
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) nav.classList.add('active');
    this.current = page;
    // close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
    // page-specific load
    if (page === 'wordbook') WordBook.render();
    if (page === 'progress') Progress.render();
    if (page === 'home') Home.load();
    window.scrollTo(0, 0);
  }
};

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
const Toast = {
  timer: null,
  show(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { t.className = 'toast'; }, 3000);
  }
};

/* ============================================================
   HOME PAGE
   ============================================================ */
const Home = {
  async load() {
    const s = Store.getStats();
    document.getElementById('stat-streak').textContent = s.streak;
    document.getElementById('stat-score').textContent = s.xp;
    document.getElementById('stat-words').textContent = Store.getWordBook().length;
    const acc = s.vocabTotal + s.grammarTotal > 0
      ? Math.round(((s.vocabCorrect + s.grammarCorrect) / (s.vocabTotal + s.grammarTotal)) * 100)
      : 0;
    document.getElementById('stat-accuracy').textContent = acc + '%';
    const sidebarLevel = document.getElementById('sidebar-level-text');
    sidebarLevel.textContent = Levels[getCurrentLevel(s.xp)].name;
    await this.loadWotd();
  },

  async loadWotd() {
    const wordEl   = document.getElementById('wotd-word');
    const pronEl   = document.getElementById('wotd-pronunciation');
    const defEl    = document.getElementById('wotd-definition');
    const exEl     = document.getElementById('wotd-example');

    // Cache WOTD per day
    const cached = Store.get('wotd_cache');
    const today  = new Date().toDateString();
    if (cached && cached.date === today) {
      wordEl.textContent  = cached.word;
      pronEl.textContent  = cached.pronunciation;
      defEl.textContent   = cached.definition;
      exEl.textContent    = `"${cached.example}"`;
      return;
    }

    wordEl.textContent = 'Loading...';
    defEl.textContent  = 'Fetching your word of the day...';
    try {
      const data = await GeminiAI.call(`Give me one interesting English word suitable for a beginner to intermediate learner.
Return ONLY valid JSON in this exact structure:
{
  "word": "...",
  "pronunciation": "...",
  "partOfSpeech": "...",
  "definition": "...",
  "example": "..."
}`, true);
      wordEl.textContent  = data.word;
      pronEl.textContent  = `/${data.pronunciation}/ — ${data.partOfSpeech}`;
      defEl.textContent   = data.definition;
      exEl.textContent    = `"${data.example}"`;
      Store.set('wotd_cache', { ...data, date: today });
    } catch (e) {
      if (e.message === 'NO_API_KEY') {
        wordEl.textContent = '—';
        defEl.textContent  = 'Set your API key in Settings to load the word of the day.';
      } else {
        wordEl.textContent = '—';
        defEl.textContent  = 'Could not load word of the day. Check your internet connection.';
      }
    }
  }
};

/* ============================================================
   VOCABULARY QUIZ
   ============================================================ */
const VocabQuiz = {
  difficulty: 'beginner',
  numQ: 5,
  currentQ: 0,
  score: 0,
  questions: [],
  newWords: [],

  init() {
    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.difficulty = b.dataset.diff;
      });
    });
    // Number buttons
    document.querySelectorAll('.num-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.num-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.numQ = parseInt(b.dataset.num);
      });
    });
    document.getElementById('start-vocab-quiz').addEventListener('click', () => this.start());
    document.getElementById('vq-next-btn').addEventListener('click', () => this.nextQuestion());
    document.getElementById('vq-try-again').addEventListener('click', () => this.reset());
    document.getElementById('vq-goto-wordbook').addEventListener('click', () => Router.go('wordbook'));
  },

  reset() {
    this.currentQ = 0; this.score = 0; this.questions = []; this.newWords = [];
    document.getElementById('vq-setup').style.display = '';
    document.getElementById('vq-active').style.display = 'none';
    document.getElementById('vq-results').style.display = 'none';
  },

  async start() {
    if (!GeminiAI.getKey()) { showApiModal(); return; }
    document.getElementById('vq-setup').style.display = 'none';
    document.getElementById('vq-active').style.display = '';
    this.currentQ = 0; this.score = 0; this.questions = []; this.newWords = [];
    await this.loadAndShowQuestion();
  },

  async loadAndShowQuestion() {
    const loading = document.getElementById('vq-loading');
    const content = document.getElementById('vq-question-content');
    loading.style.display = 'flex';
    content.style.display = 'none';
    document.getElementById('vq-feedback').style.display = 'none';
    document.getElementById('vq-next-btn').style.display = 'none';

    this.updateProgress();

    try {
      const usedWords = this.questions.map(q => q.word).join(', ');
      const prompt = `Generate a vocabulary multiple-choice quiz question for an English learner at ${this.difficulty} level.
${usedWords ? `Do NOT use these words: ${usedWords}.` : ''}
Return ONLY valid JSON with this exact structure:
{
  "word": "the vocabulary word being tested",
  "question": "the question text (e.g. What does the word 'X' mean?)",
  "options": ["option A", "option B", "option C", "option D"],
  "correctIndex": 0,
  "explanation": "brief explanation of the correct answer (1-2 sentences)",
  "pronunciation": "phonetic pronunciation",
  "partOfSpeech": "noun/verb/adjective/etc",
  "example": "a sentence using the word in context"
}`;
      const q = await GeminiAI.call(prompt, true);
      this.questions.push(q);
      this.showQuestion(q);
    } catch (e) {
      Toast.show(`Error: ${e.message}`, 'error');
      this.reset();
    }
  },

  showQuestion(q) {
    const loading = document.getElementById('vq-loading');
    const content = document.getElementById('vq-question-content');
    loading.style.display = 'none';
    content.style.display = '';

    document.getElementById('vq-question-text').textContent = q.question;
    const optContainer = document.getElementById('vq-options');
    optContainer.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => this.selectAnswer(i, q));
      optContainer.appendChild(btn);
    });
  },

  selectAnswer(selectedIdx, q) {
    document.querySelectorAll('#vq-options .option-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correctIndex) btn.classList.add('correct');
      else if (i === selectedIdx && selectedIdx !== q.correctIndex) btn.classList.add('wrong');
    });

    const isCorrect = selectedIdx === q.correctIndex;
    const fb = document.getElementById('vq-feedback');
    fb.style.display = '';

    if (isCorrect) {
      this.score++;
      fb.className = 'feedback-box correct';
      fb.innerHTML = `✅ <strong>Correct!</strong> ${q.explanation}<br><em style="font-size:0.82rem;opacity:0.8">Example: "${q.example}"</em>`;
    } else {
      fb.className = 'feedback-box wrong';
      fb.innerHTML = `❌ <strong>Incorrect.</strong> The correct answer was "<strong>${q.options[q.correctIndex]}</strong>".<br>${q.explanation}<br><em style="font-size:0.82rem;opacity:0.8">Example: "${q.example}"</em>`;
    }

    // Always collect the word
    this.newWords.push({
      word: q.word,
      pronunciation: q.pronunciation,
      partOfSpeech: q.partOfSpeech,
      definition: q.options[q.correctIndex],
      example: q.example,
      source: 'Vocab Quiz'
    });

    // update stats
    const s = Store.getStats();
    s.vocabTotal++;
    if (isCorrect) s.vocabCorrect++;
    Store.saveStats(s);

    document.getElementById('vq-next-btn').style.display = '';
    document.getElementById('vq-score-display').textContent = `Score: ${this.score}`;
  },

  updateProgress() {
    const fill = document.getElementById('vq-progress-fill');
    const pct = (this.currentQ / this.numQ) * 100;
    fill.style.width = pct + '%';
    document.getElementById('vq-question-num').textContent = `Q ${this.currentQ + 1} / ${this.numQ}`;
  },

  async nextQuestion() {
    this.currentQ++;
    if (this.currentQ >= this.numQ) {
      this.showResults();
    } else {
      await this.loadAndShowQuestion();
    }
  },

  showResults() {
    document.getElementById('vq-active').style.display = 'none';
    document.getElementById('vq-results').style.display = '';
    const pct = Math.round((this.score / this.numQ) * 100);
    let emoji = pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : pct >= 40 ? '👍' : '💪';
    let title = pct >= 80 ? 'Excellent Work!' : pct >= 60 ? 'Good Job!' : pct >= 40 ? 'Keep Practicing!' : 'Don\'t Give Up!';
    document.getElementById('vq-result-emoji').textContent = emoji;
    document.getElementById('vq-result-title').textContent = title;
    document.getElementById('vq-result-score').textContent = `${this.score} / ${this.numQ}`;
    document.getElementById('vq-result-breakdown').textContent = `${pct}% accuracy • ${this.newWords.length} words collected`;

    // Save to wordbook
    Store.addWords(this.newWords);

    // XP
    const xpGained = this.score * 20 + 10;
    Store.addXP(xpGained);
    Store.getStats(); // refresh
    const s = Store.getStats();
    s.totalQuizzes = (s.totalQuizzes || 0) + 1;
    Store.saveStats(s);
    Store.addActivity({ icon: '✍️', title: `Vocab Quiz — ${pct}% accuracy`, xp: xpGained });
    Toast.show(`+${xpGained} XP earned! 🎉`, 'success');

    // Render new words
    const wList = document.getElementById('vq-new-words-list');
    wList.innerHTML = '';
    this.newWords.forEach(w => {
      const d = document.createElement('div');
      d.className = 'new-word-item';
      d.innerHTML = `<div class="new-word-term">${w.word} <small style="font-weight:400;color:var(--text-muted)">${w.partOfSpeech || ''}</small></div><div class="new-word-def">${w.definition}</div><div class="new-word-example">"${w.example}"</div>`;
      wList.appendChild(d);
    });
  }
};

/* ============================================================
   GRAMMAR QUIZ
   ============================================================ */
const GrammarQuiz = {
  topic: 'tenses',
  numQ: 5,
  currentQ: 0,
  score: 0,
  questions: [],

  init() {
    document.querySelectorAll('.grammar-topic-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.grammar-topic-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.topic = b.dataset.gtopic;
      });
    });
    document.querySelectorAll('.gnum-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.gnum-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.numQ = parseInt(b.dataset.gnum);
      });
    });
    document.getElementById('start-grammar-quiz').addEventListener('click', () => this.start());
    document.getElementById('gq-next-btn').addEventListener('click', () => this.nextQuestion());
    document.getElementById('gq-try-again').addEventListener('click', () => this.reset());
  },

  reset() {
    this.currentQ = 0; this.score = 0; this.questions = [];
    document.getElementById('gq-setup').style.display = '';
    document.getElementById('gq-active').style.display = 'none';
    document.getElementById('gq-results').style.display = 'none';
  },

  async start() {
    if (!GeminiAI.getKey()) { showApiModal(); return; }
    document.getElementById('gq-setup').style.display = 'none';
    document.getElementById('gq-active').style.display = '';
    this.currentQ = 0; this.score = 0; this.questions = [];
    await this.loadAndShowQuestion();
  },

  async loadAndShowQuestion() {
    document.getElementById('gq-loading').style.display = 'flex';
    document.getElementById('gq-question-content').style.display = 'none';
    document.getElementById('gq-feedback').style.display = 'none';
    document.getElementById('gq-next-btn').style.display = 'none';
    this.updateProgress();

    try {
      const prompt = `Generate an English grammar multiple-choice quiz question about "${this.topic}" for a beginner to intermediate English learner.
Return ONLY valid JSON:
{
  "question": "the grammar question or fill-in-the-blank sentence",
  "options": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "clear explanation of the grammar rule (2-3 sentences)"
}`;
      const q = await GeminiAI.call(prompt, true);
      this.questions.push(q);
      this.showQuestion(q);
    } catch (e) {
      Toast.show(`Error: ${e.message}`, 'error');
      this.reset();
    }
  },

  showQuestion(q) {
    document.getElementById('gq-loading').style.display = 'none';
    document.getElementById('gq-question-content').style.display = '';
    document.getElementById('gq-question-text').textContent = q.question;
    const optContainer = document.getElementById('gq-options');
    optContainer.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => this.selectAnswer(i, q));
      optContainer.appendChild(btn);
    });
  },

  selectAnswer(selectedIdx, q) {
    document.querySelectorAll('#gq-options .option-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correctIndex) btn.classList.add('correct');
      else if (i === selectedIdx && selectedIdx !== q.correctIndex) btn.classList.add('wrong');
    });

    const isCorrect = selectedIdx === q.correctIndex;
    const fb = document.getElementById('gq-feedback');
    fb.style.display = '';
    if (isCorrect) {
      this.score++;
      fb.className = 'feedback-box correct';
      fb.innerHTML = `✅ <strong>Correct!</strong> ${q.explanation}`;
    } else {
      fb.className = 'feedback-box wrong';
      fb.innerHTML = `❌ <strong>Incorrect.</strong> Correct: "<strong>${q.options[q.correctIndex]}</strong>".<br>${q.explanation}`;
    }
    const s = Store.getStats();
    s.grammarTotal++;
    if (isCorrect) s.grammarCorrect++;
    Store.saveStats(s);
    document.getElementById('gq-next-btn').style.display = '';
    document.getElementById('gq-score-display').textContent = `Score: ${this.score}`;
  },

  updateProgress() {
    document.getElementById('gq-progress-fill').style.width = (this.currentQ / this.numQ * 100) + '%';
    document.getElementById('gq-question-num').textContent = `Q ${this.currentQ + 1} / ${this.numQ}`;
  },

  async nextQuestion() {
    this.currentQ++;
    if (this.currentQ >= this.numQ) this.showResults();
    else await this.loadAndShowQuestion();
  },

  showResults() {
    document.getElementById('gq-active').style.display = 'none';
    document.getElementById('gq-results').style.display = '';
    const pct = Math.round((this.score / this.numQ) * 100);
    document.getElementById('gq-result-emoji').textContent = pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : '💪';
    document.getElementById('gq-result-title').textContent = pct >= 80 ? 'Grammar Master!' : pct >= 60 ? 'Well Done!' : 'Keep Practicing!';
    document.getElementById('gq-result-score').textContent = `${this.score} / ${this.numQ}`;
    document.getElementById('gq-result-breakdown').textContent = `${pct}% accuracy on ${this.topic}`;
    const xp = this.score * 15 + 5;
    Store.addXP(xp);
    const s = Store.getStats();
    s.totalQuizzes = (s.totalQuizzes || 0) + 1;
    Store.saveStats(s);
    Store.addActivity({ icon: '📝', title: `Grammar Quiz (${this.topic}) — ${pct}%`, xp });
    Toast.show(`+${xp} XP earned! 🎉`, 'success');
  }
};

/* ============================================================
   SPEAKING TEST
   ============================================================ */
const SpeakingTest = {
  topic: 'daily-life',
  recognition: null,
  isRecording: false,
  transcript: '',
  currentPrompt: null,

  init() {
    document.querySelectorAll('.topic-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.topic-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.topic = b.dataset.topic;
      });
    });
    document.getElementById('start-speaking').addEventListener('click', () => this.start());
    document.getElementById('mic-btn').addEventListener('click', () => this.toggleRecording());
    document.getElementById('sp-analyze-btn').addEventListener('click', () => this.analyzeSpeeech());
    document.getElementById('sp-new-prompt').addEventListener('click', () => this.loadPrompt());
  },

  async start() {
    if (!GeminiAI.getKey()) { showApiModal(); return; }
    document.getElementById('sp-setup').style.display = 'none';
    document.getElementById('sp-active').style.display = '';
    await this.loadPrompt();
  },

  async loadPrompt() {
    document.getElementById('sp-prompt-loading').style.display = 'flex';
    document.getElementById('sp-prompt-content').style.display = 'none';
    document.getElementById('sp-feedback').style.display = 'none';
    document.getElementById('sp-analyze-btn').style.display = 'none';
    document.getElementById('sp-transcript').style.display = 'none';
    this.transcript = '';
    document.getElementById('recording-status').textContent = 'Click the mic to start recording';
    document.getElementById('mic-btn').classList.remove('recording');
    document.getElementById('mic-rings').innerHTML = '';

    try {
      const data = await GeminiAI.call(`Generate a speaking prompt for an English beginner/elementary learner about the topic: "${this.topic}".
Return ONLY valid JSON:
{
  "prompt": "the speaking question or topic (1-2 sentences)",
  "tips": ["tip 1", "tip 2", "tip 3"],
  "timeLimit": 60
}`, true);
      this.currentPrompt = data;
      document.getElementById('sp-prompt-loading').style.display = 'none';
      document.getElementById('sp-prompt-content').style.display = '';
      document.getElementById('sp-prompt-text').textContent = data.prompt;
      document.getElementById('sp-tips').innerHTML = '💡 <strong>Tips:</strong> ' + data.tips.join(' • ');
    } catch (e) {
      document.getElementById('sp-prompt-loading').style.display = 'none';
      Toast.show(`Error: ${e.message}`, 'error');
    }
  },

  toggleRecording() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      Toast.show('🎤 Speech recognition not supported in this browser. Try Chrome!', 'warning');
      return;
    }
    if (this.isRecording) { this.stopRecording(); }
    else { this.startRecording(); }
  },

  startRecording() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.lang = 'en-US';
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onstart = () => {
      this.isRecording = true;
      document.getElementById('mic-btn').classList.add('recording');
      document.getElementById('recording-status').textContent = '🔴 Recording... speak now!';
      this.addRings();
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      this.transcript += final;
      document.getElementById('sp-transcript').style.display = '';
      document.getElementById('sp-transcript-text').textContent = this.transcript + (interim ? ' ' + interim : '');
    };

    this.recognition.onerror = (e) => {
      Toast.show('Microphone error: ' + e.error, 'error');
      this.isRecording = false;
      document.getElementById('mic-btn').classList.remove('recording');
      document.getElementById('mic-rings').innerHTML = '';
    };

    this.recognition.onend = () => {
      if (this.isRecording) { this.recognition.start(); } // keep going
    };

    this.recognition.start();
  },

  stopRecording() {
    this.isRecording = false;
    if (this.recognition) { this.recognition.onend = null; this.recognition.stop(); }
    document.getElementById('mic-btn').classList.remove('recording');
    document.getElementById('mic-rings').innerHTML = '';
    document.getElementById('recording-status').textContent = '✅ Recording stopped. Click "Analyze" to get feedback.';
    if (this.transcript.trim().length > 5) {
      document.getElementById('sp-analyze-btn').style.display = '';
    } else {
      document.getElementById('recording-status').textContent = '❗ Too short. Please record more speech.';
    }
  },

  addRings() {
    const rings = document.getElementById('mic-rings');
    rings.innerHTML = '<div class="mic-ring"></div><div class="mic-ring"></div><div class="mic-ring"></div>';
  },

  async analyzeSpeeech() {
    if (!this.transcript.trim()) { Toast.show('Please record something first!', 'warning'); return; }
    const btn = document.getElementById('sp-analyze-btn');
    btn.disabled = true; btn.textContent = 'Analyzing...';

    const fb = document.getElementById('sp-feedback');
    fb.style.display = '';
    fb.className = 'feedback-box info';
    fb.innerHTML = '<div class="spinner" style="width:24px;height:24px;margin:0 auto"></div><p style="text-align:center;margin-top:0.5rem">Analyzing your speech with AI...</p>';

    try {
      const prompt = `You are an English speaking coach. A beginner/elementary English learner was asked to speak about:
"${this.currentPrompt?.prompt || 'a topic'}"

Their speech (transcribed): "${this.transcript}"

Provide encouraging, constructive feedback. Return ONLY valid JSON:
{
  "overallScore": 75,
  "fluencyScore": 80,
  "vocabularyScore": 70,
  "contentScore": 75,
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "correctedSentence": "a corrected/improved version of what they said",
  "encouragement": "a warm encouraging message"
}`;
      const data = await GeminiAI.call(prompt, true);

      fb.className = 'feedback-box info';
      fb.innerHTML = `
        <h4 style="margin-bottom:0.75rem;font-family:'Poppins',sans-serif">🎯 Speaking Feedback</h4>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:1rem;text-align:center">
          <div style="background:white;border-radius:10px;padding:0.75rem">
            <div style="font-size:1.4rem;font-weight:800;color:var(--primary)">${data.overallScore}<span style="font-size:0.75rem">/100</span></div>
            <div style="font-size:0.75rem;color:var(--text-muted)">Overall</div>
          </div>
          <div style="background:white;border-radius:10px;padding:0.75rem">
            <div style="font-size:1.4rem;font-weight:800;color:var(--success)">${data.fluencyScore}<span style="font-size:0.75rem">/100</span></div>
            <div style="font-size:0.75rem;color:var(--text-muted)">Fluency</div>
          </div>
          <div style="background:white;border-radius:10px;padding:0.75rem">
            <div style="font-size:1.4rem;font-weight:800;color:var(--warning)">${data.vocabularyScore}<span style="font-size:0.75rem">/100</span></div>
            <div style="font-size:0.75rem;color:var(--text-muted)">Vocabulary</div>
          </div>
        </div>
        <p><strong>✨ Strengths:</strong> ${data.strengths.join(', ')}</p>
        <p style="margin-top:0.5rem"><strong>📈 Improve:</strong> ${data.improvements.join(', ')}</p>
        ${data.correctedSentence ? `<p style="margin-top:0.5rem;font-style:italic;background:white;padding:0.75rem;border-radius:8px"><strong>💬 Better version:</strong> "${data.correctedSentence}"</p>` : ''}
        <p style="margin-top:0.75rem;font-style:italic;color:var(--primary-dark)">💪 ${data.encouragement}</p>
      `;

      const xp = Math.round(data.overallScore / 5);
      Store.addXP(xp);
      const s = Store.getStats();
      s.speakingDone = (s.speakingDone || 0) + 1;
      Store.saveStats(s);
      Store.addActivity({ icon: '🎤', title: `Speaking Test — ${data.overallScore}/100`, xp });
      Toast.show(`+${xp} XP for speaking! 🎤`, 'success');
    } catch (e) {
      fb.className = 'feedback-box wrong';
      fb.textContent = 'Could not analyze: ' + e.message;
    }

    btn.disabled = false; btn.textContent = 'Analyze My Speech →';
  }
};

/* ============================================================
   WORD BOOK
   ============================================================ */
const WordBook = {
  render() {
    const words = Store.getWordBook();
    const search = (document.getElementById('wb-search').value || '').toLowerCase();
    const filtered = search ? words.filter(w => w.word.toLowerCase().includes(search) || w.definition?.toLowerCase().includes(search)) : words;

    document.getElementById('wb-empty').style.display = filtered.length === 0 ? '' : 'none';
    const list = document.getElementById('wb-list');
    list.innerHTML = '';
    filtered.forEach(w => {
      const card = document.createElement('div');
      card.className = 'wb-word-card';
      card.innerHTML = `
        <div class="wb-word-header">
          <span class="wb-word">${w.word}</span>
          ${w.partOfSpeech ? `<span class="wb-type">${w.partOfSpeech}</span>` : ''}
        </div>
        ${w.pronunciation ? `<div class="wb-pronunciation">/${w.pronunciation}/</div>` : ''}
        <div class="wb-definition">${w.definition || '—'}</div>
        ${w.example ? `<div class="wb-example">"${w.example}"</div>` : ''}
        ${w.source ? `<div class="wb-source">📌 ${w.source}</div>` : ''}
      `;
      list.appendChild(card);
    });
  }
};

/* ============================================================
   PROGRESS
   ============================================================ */
const Progress = {
  render() {
    const s = Store.getStats();
    const idx = getCurrentLevel(s.xp);
    const nextLvl = getNextLevel(s.xp);
    document.getElementById('pr-current-level').textContent = Levels[idx].name;
    const xpInLevel = s.xp - Levels[idx].minXP;
    const xpNeeded = nextLvl ? nextLvl.minXP - Levels[idx].minXP : 1;
    const pct = nextLvl ? Math.min((xpInLevel / xpNeeded) * 100, 100) : 100;
    document.getElementById('pr-xp-fill').style.width = pct + '%';
    document.getElementById('pr-xp-label').textContent = nextLvl
      ? `${xpInLevel} / ${xpNeeded} XP to ${nextLvl.name}`
      : 'You\'ve reached the top level! 🏆';

    const total = s.vocabTotal + s.grammarTotal;
    const correct = s.vocabCorrect + s.grammarCorrect;
    document.getElementById('pr-total-quizzes').textContent = s.totalQuizzes || 0;
    document.getElementById('pr-correct').textContent = correct;
    document.getElementById('pr-accuracy').textContent = total ? Math.round(correct / total * 100) + '%' : '0%';

    // Skill bars
    const vPct = s.vocabTotal ? Math.round(s.vocabCorrect / s.vocabTotal * 100) : 0;
    const gPct = s.grammarTotal ? Math.round(s.grammarCorrect / s.grammarTotal * 100) : 0;
    const spPct = Math.min((s.speakingDone || 0) * 20, 100);
    document.getElementById('sk-vocab').style.width = vPct + '%';
    document.getElementById('sk-vocab-pct').textContent = vPct + '%';
    document.getElementById('sk-grammar').style.width = gPct + '%';
    document.getElementById('sk-grammar-pct').textContent = gPct + '%';
    document.getElementById('sk-speaking').style.width = spPct + '%';
    document.getElementById('sk-speaking-pct').textContent = spPct + '%';

    // Accuracy for home stat
    document.getElementById('stat-accuracy') && (document.getElementById('stat-accuracy').textContent = (total ? Math.round(correct / total * 100) : 0) + '%');

    // Activity
    const activities = Store.getActivity();
    const actList = document.getElementById('pr-activity-list');
    if (!activities.length) {
      actList.innerHTML = '<p class="empty-activity">No activity yet. Start a quiz!</p>';
    } else {
      actList.innerHTML = '';
      activities.slice(0, 10).forEach(a => {
        const el = document.createElement('div');
        el.className = 'activity-item';
        const t = new Date(a.time);
        const timeStr = t.toLocaleDateString() + ' ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el.innerHTML = `<span class="activity-icon">${a.icon}</span><div class="activity-info"><div class="activity-title">${a.title}</div><div class="activity-time">${timeStr}</div></div><span class="activity-xp">+${a.xp} XP</span>`;
        actList.appendChild(el);
      });
    }
  }
};

/* ============================================================
   SETTINGS
   ============================================================ */
const Settings = {
  init() {
    // Pre-fill saved values
    const savedKey = GeminiAI.getKey();
    if (savedKey) { document.getElementById('api-key-input').value = savedKey; }
    const savedName = Store.get('user_name', '');
    if (savedName) document.getElementById('user-name-input').value = savedName;
    const savedGoal = Store.get('daily_goal', 10);
    document.querySelectorAll('.goal-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.goal) === savedGoal);
    });

    document.getElementById('save-api-key').addEventListener('click', () => {
      const key = document.getElementById('api-key-input').value.trim();
      if (!key) { Toast.show('Please enter an API key', 'error'); return; }
      localStorage.setItem('learnify_api_key', key);
      Toast.show('API key saved! ✅', 'success');
    });

    document.getElementById('save-name').addEventListener('click', () => {
      const name = document.getElementById('user-name-input').value.trim();
      if (name) { Store.set('user_name', name); Toast.show(`Name saved: ${name}`, 'success'); }
    });

    document.querySelectorAll('.goal-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.goal-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        Store.set('daily_goal', parseInt(b.dataset.goal));
        Toast.show('Goal updated!', 'success');
      });
    });

    document.getElementById('reset-progress').addEventListener('click', () => {
      if (confirm('⚠️ This will erase ALL your progress, word book, and XP. Are you sure?')) {
        ['stats', 'wordbook', 'activity', 'wotd_cache'].forEach(k => localStorage.removeItem('learnify_' + k));
        Toast.show('Progress reset.', 'warning');
        Home.load();
      }
    });
  }
};

/* ============================================================
   API KEY MODAL
   ============================================================ */
function showApiModal() {
  document.getElementById('api-key-modal').classList.remove('hidden');
}
function hideApiModal() {
  document.getElementById('api-key-modal').classList.add('hidden');
}

/* ============================================================
   INIT — Bootstrap everything
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      Router.go(item.dataset.page);
    });
  });

  // Quickstart cards & empty-state buttons
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => Router.go(btn.dataset.goto));
  });

  // Hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Word book search
  document.getElementById('wb-search').addEventListener('input', () => WordBook.render());
  document.getElementById('wb-clear').addEventListener('click', () => {
    if (confirm('Clear all saved words?')) { Store.clearWordBook(); WordBook.render(); Toast.show('Word book cleared.'); }
  });

  // API Key Modal
  document.getElementById('modal-save-key').addEventListener('click', () => {
    const key = document.getElementById('modal-api-key').value.trim();
    if (!key) { Toast.show('Please enter your API key', 'error'); return; }
    localStorage.setItem('learnify_api_key', key);
    document.getElementById('api-key-input').value = key;
    hideApiModal();
    Toast.show('API key saved! Ready to learn 🚀', 'success');
    Home.load();
  });

  // Init modules
  VocabQuiz.init();
  GrammarQuiz.init();
  SpeakingTest.init();
  Settings.init();

  // Show API modal if no key
  if (!GeminiAI.getKey()) {
    document.getElementById('api-key-modal').classList.remove('hidden');
  } else {
    document.getElementById('api-key-modal').classList.add('hidden');
  }

  // Load home
  Home.load();
  Router.go('home');
});

