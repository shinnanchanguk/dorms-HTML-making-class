require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, queries, getEffectiveSessionLimit, isWithinTimeRestriction } = require('./db');
const createSqliteSessionStore = require('./sqlite-session-store');

const app = express();
const PORT = process.env.PORT || 3000;
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf-8');
const STREAM_IDLE_TIMEOUT_MS = 120 * 1000;
const SSE_HEARTBEAT_INTERVAL_MS = 15000;
const STREAM_CONTINUATION_ATTEMPTS = 2;

// ── (선택) 제출물·대화로그를 외부 폴더에도 자동 백업 ──────────
// .env 의 LOCAL_ARCHIVE_DIR 를 설정하면 그 폴더에 사본을 저장한다.
// 비워두면(기본값) 외부 백업 없이 DB와 uploads/ 에만 저장한다.
const LOCAL_ARCHIVE_DIR = process.env.LOCAL_ARCHIVE_DIR || '';
const LOCAL_SUBMIT_DIR = LOCAL_ARCHIVE_DIR ? path.join(LOCAL_ARCHIVE_DIR, '제출물') : '';
const LOCAL_LOG_DIR = LOCAL_ARCHIVE_DIR ? path.join(LOCAL_ARCHIVE_DIR, '대화로그') : '';

function saveToLocal(type, problemUnit, problemName, studentId, fileName, content) {
  if (!LOCAL_ARCHIVE_DIR) return;
  try {
    const problemDir = `${problemUnit}_${problemName}`.replace(/[\/\\:*?"<>|]/g, '_');
    const baseDir = type === 'submit' ? LOCAL_SUBMIT_DIR : LOCAL_LOG_DIR;
    const dir = type === 'submit'
      ? path.join(baseDir, problemDir)
      : path.join(baseDir, problemDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
  } catch (err) {
    console.error(`로컬 저장 실패 (${type}):`, err.message);
  }
}

function saveChatLog(sessionId) {
  if (!LOCAL_ARCHIVE_DIR) return;
  try {
    const chatSession = queries.getSession.get(sessionId);
    if (!chatSession) return;
    const user = queries.getUserById.get(chatSession.user_id);
    if (!user) return;
    const messages = queries.getSessionMessages.all(sessionId);
    if (messages.length === 0) return;

    let logText = `=== 대화 로그 ===\n`;
    logText += `학번: ${user.student_id} | 반: ${user.class_num} | 번호: ${user.student_num}\n`;
    logText += `문제: ${chatSession.problem_unit} - ${chatSession.problem_name}\n`;
    logText += `세션 ID: ${sessionId}\n`;
    logText += `${'='.repeat(40)}\n\n`;

    for (const msg of messages) {
      const role = msg.role === 'user' ? '학생' : 'AI';
      let content = msg.content;
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          content = parsed.filter(p => p.type === 'text').map(p => p.text).join('\n');
          if (parsed.some(p => p.type === 'image_url')) content += '\n[이미지 첨부]';
        }
      } catch {}
      logText += `[${role}] ${msg.created_at}\n${content}\n\n`;
    }

    const fileName = `${user.student_id}_세션${sessionId}.txt`;
    saveToLocal('log', chatSession.problem_unit, chatSession.problem_name, user.student_id, fileName, logText);
  } catch (err) {
    console.error('대화로그 저장 실패:', err.message);
  }
}

// ── Middleware ───────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: createSqliteSessionStore(session, db),
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Upload config for HTML submissions
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const user = queries.getUserById.get(req.session.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
}

// ── Auth API ────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { studentId, password } = req.body;
  const user = queries.getUserByStudentId.get(studentId);
  if (!user) return res.status(404).json({ error: '존재하지 않는 학번입니다.' });

  // First login - no password set yet
  if (!user.password_hash) {
    return res.json({ needsPassword: true, studentId: user.student_id });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
  }

  req.session.userId = user.id;
  res.json({ success: true, role: user.role, studentId: user.student_id });
});

app.post('/api/set-password', (req, res) => {
  const { studentId, password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  }
  const user = queries.getUserByStudentId.get(studentId);
  if (!user) return res.status(404).json({ error: '존재하지 않는 학번입니다.' });
  if (user.password_hash) return res.status(400).json({ error: '이미 비밀번호가 설정되어 있습니다.' });

  const hash = bcrypt.hashSync(password, 10);
  queries.setPassword.run(hash, user.id);
  req.session.userId = user.id;
  res.json({ success: true, role: user.role, studentId: user.student_id });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = queries.getUserById.get(req.session.userId);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  const sessionCount = queries.getStudentSessionCount.get(user.id).cnt;
  const maxSessions = getEffectiveSessionLimit(user);

  res.json({
    studentId: user.student_id,
    role: user.role,
    classNum: user.class_num,
    studentNum: user.student_num,
    sessionCount,
    maxSessions
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ── Session API ─────────────────────────────────────────
app.post('/api/sessions', requireAuth, (req, res) => {
  const user = queries.getUserById.get(req.session.userId);
  const { problemUnit, problemName } = req.body;
  // 단원/문제 선택 UI를 없앴으므로, 값이 없으면 기본값으로 채운다.
  const unit = (problemUnit && String(problemUnit).trim()) || '수학';
  const name = (problemName && String(problemName).trim()) || '풀이';

  // Check session limit
  const sessionCount = queries.getStudentSessionCount.get(user.id).cnt;
  const maxSessions = getEffectiveSessionLimit(user);
  if (sessionCount >= maxSessions) {
    return res.status(403).json({ error: `세션 횟수 제한에 도달했습니다. (${sessionCount}/${maxSessions})` });
  }

  const result = queries.createSession.run(user.id, unit, name);
  const newSession = queries.getSession.get(result.lastInsertRowid);

  // Check time restriction for this session number
  const sessionNumber = sessionCount + 1;
  const timeCheck = isWithinTimeRestriction(user, sessionNumber);

  res.json({ session: newSession, timeCheck });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = queries.getUserSessions.all(req.session.userId);
  res.json(sessions);
});

app.get('/api/sessions/:id/messages', requireAuth, (req, res) => {
  const messages = queries.getSessionMessages.all(req.params.id);
  res.json(messages);
});

// ── Chat API (SSE streaming) ────────────────────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const { sessionId, message, imageBase64 } = req.body;
  const user = queries.getUserById.get(req.session.userId);

  // Validate session
  const chatSession = queries.getSession.get(sessionId);
  if (!chatSession || chatSession.user_id !== user.id) {
    return res.status(403).json({ error: '유효하지 않은 세션입니다.' });
  }
  if (chatSession.status === 'ended') {
    return res.status(403).json({ error: '종료된 세션입니다.' });
  }

  // Check time restriction
  const sessionCount = queries.getUserSessions.all(user.id)
    .findIndex(s => s.id === chatSession.id) + 1;
  const timeCheck = isWithinTimeRestriction(user, sessionCount);
  if (!timeCheck.allowed) {
    return res.status(403).json({ error: timeCheck.reason });
  }

  // Build user content (text + optional image)
  let userContent;
  if (imageBase64) {
    userContent = JSON.stringify([
      { type: 'text', text: message || '풀이 사진입니다.' },
      { type: 'image_url', image_url: { url: imageBase64 } }
    ]);
  } else {
    userContent = message;
  }

  // Save user message to DB
  queries.addMessage.run(sessionId, 'user', userContent);

  // Build messages array for API (Gemini - multimodal support)
  const dbMessages = queries.getSessionMessages.all(sessionId);
  const apiMessages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    }
  ];

  for (const msg of dbMessages) {
    let content;
    try {
      const parsed = JSON.parse(msg.content);
      if (Array.isArray(parsed)) {
        content = parsed; // 멀티모달 콘텐츠 직접 전달
      } else {
        content = msg.content;
      }
    } catch {
      content = msg.content;
    }
    apiMessages.push({ role: msg.role, content });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // Disable Nagle algorithm for immediate SSE delivery
  if (res.socket) res.socket.setNoDelay(true);

  let fullResponse = '';
  let clientConnected = true;
  let currentAbortController = null;

  // Detect a real client disconnect via the RESPONSE 'close' event only.
  // NOTE: req('close') is unreliable here — express.json() fully consumes the
  // request body before this handler runs, so req emits 'close' almost
  // immediately on normal requests (not a disconnect). Using it would abort the
  // upstream AI fetch instantly and the client would hang forever.
  const closeHandler = () => {
    if (res.writableEnded) return; // normal completion, not a disconnect
    clientConnected = false;
    if (currentAbortController) {
      currentAbortController.abort();
    }
  };
  res.on('close', closeHandler);

  function cleanupRequest() {
    clearInterval(heartbeatInterval);
    res.removeListener('close', closeHandler);
  }

  function safeSend(data) {
    if (clientConnected && !res.writableEnded) {
      try {
        res.write(data);
        // Flush immediately for real-time SSE streaming
        if (res.socket && !res.socket.destroyed) {
          res.socket.uncork();
          res.socket.cork();
        }
      } catch {}
    }
  }

  const heartbeatInterval = setInterval(() => {
    safeSend(': keep-alive\n\n');
  }, SSE_HEARTBEAT_INTERVAL_MS);

  function trimRepeatedPrefix(existingText, incomingText) {
    const maxOverlap = Math.min(existingText.length, incomingText.length, 120);
    for (let len = maxOverlap; len > 0; len--) {
      if (existingText.slice(-len) === incomingText.slice(0, len)) {
        return incomingText.slice(len);
      }
    }
    return incomingText;
  }

  function buildAttemptMessages() {
    if (!fullResponse) return apiMessages;
    return [
      ...apiMessages,
      { role: 'assistant', content: fullResponse },
      {
        role: 'user',
        content: '방금 답변이 스트리밍 중간에 끊겼습니다. 이미 작성한 내용은 반복하지 말고 정확히 다음 문장부터 자연스럽게 이어서 계속 답하세요. 끊긴 문장, 목록, 코드블록, HTML이 있으면 완결되게 마무리하세요.'
      }
    ];
  }

  async function streamOneAttempt(messages) {
    currentAbortController = new AbortController();
    let idleTimeout = null;

    function resetIdleTimeout() {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        currentAbortController.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    }

    function cleanupAttempt() {
      clearTimeout(idleTimeout);
      currentAbortController = null;
    }

    function processSseLine(line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) return false;
      if (!trimmed.startsWith('data: ')) return false;
      const data = trimmed.slice(6).trim();
      if (data === '[DONE]') return true;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          const content = trimRepeatedPrefix(fullResponse, delta);
          if (content) {
            fullResponse += content;
            safeSend(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
      } catch {}
      return false;
    }

    try {
      resetIdleTimeout();

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'HTML Making Class'
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'google/gemini-2.5-flash',
          messages,
          max_tokens: 16000,
          temperature: 0.7,
          stream: true
        }),
        signal: currentAbortController.signal
      });

      if (!response.ok) {
        const err = await response.text();
        return { type: 'http-error', statusCode: response.status, detail: err };
      }

      const reader = response.body;
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      for await (const chunk of reader) {
        if (streamDone) break;
        resetIdleTimeout();
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (processSseLine(line)) {
            streamDone = true;
            break;
          }
        }
      }

      if (!streamDone && buffer.trim()) {
        streamDone = processSseLine(buffer);
      }

      if (streamDone) {
        return { type: 'done' };
      }
      return { type: 'retryable', reason: 'stream-ended' };

    } catch (err) {
      if (err.name === 'AbortError') {
        return { type: clientConnected ? 'retryable' : 'client-disconnect', reason: 'idle-timeout' };
      }
      console.error('Chat error:', err);
      return { type: 'retryable', reason: 'network-error' };
    } finally {
      cleanupAttempt();
    }
  }

  try {
    let finalError = null;
    let streamCompleted = false;

    for (let attempt = 0; attempt <= STREAM_CONTINUATION_ATTEMPTS; attempt++) {
      if (!clientConnected) break;

      const result = await streamOneAttempt(buildAttemptMessages());
      if (result.type === 'done') {
        streamCompleted = true;
        break;
      }
      if (result.type === 'client-disconnect') {
        break;
      }
      if (result.type === 'http-error') {
        finalError = `API 오류: ${result.statusCode}`;
        break;
      }

      const canRetry = attempt < STREAM_CONTINUATION_ATTEMPTS;
      if (!canRetry) {
        finalError = '응답이 중간에 끊겨 자동 이어받기를 시도했지만 끝까지 복구하지 못했습니다. 마지막 질문을 다시 보내주세요.';
        break;
      }
    }

    // Always save assistant message to DB regardless of client connection
    if (fullResponse) {
      queries.addMessage.run(sessionId, 'assistant', fullResponse);
    }
    if (!streamCompleted && finalError) {
      safeSend(`data: ${JSON.stringify({ error: finalError })}\n\n`);
    }
    safeSend('data: [DONE]\n\n');
    if (clientConnected) {
      try { res.end(); } catch {}
    }
    cleanupRequest();

  } catch (err) {
    cleanupRequest();
    console.error('Chat error:', err);
    // Still try to save whatever we got
    if (fullResponse) {
      try { queries.addMessage.run(sessionId, 'assistant', fullResponse); } catch {}
    }
    if (!res.writableEnded) {
      try {
        const errMsg = '서버 오류가 발생했습니다.';
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {}
    }
  }
});

// ── Submit API ──────────────────────────────────────────
app.post('/api/submit', requireAuth, (req, res) => {
  const { sessionId, htmlContent } = req.body;
  const user = queries.getUserById.get(req.session.userId);

  const chatSession = queries.getSession.get(sessionId);
  if (!chatSession || chatSession.user_id !== user.id) {
    return res.status(403).json({ error: '유효하지 않은 세션입니다.' });
  }

  // 같은 문제에 대한 이전 제출 삭제 (마지막 제출만 유지)
  const prevSubmissions = queries.getPreviousSubmissions.all(
    user.id, chatSession.problem_unit, chatSession.problem_name
  );
  for (const prev of prevSubmissions) {
    const prevPath = path.join(__dirname, 'uploads', prev.file_path);
    try { fs.unlinkSync(prevPath); } catch {}
    queries.deleteSubmission.run(prev.id);
  }

  // Save HTML file
  const fileName = `${user.student_id}_session${sessionId}_${Date.now()}.html`;
  const filePath = path.join(__dirname, 'uploads', fileName);
  fs.writeFileSync(filePath, htmlContent, 'utf-8');

  // Save to DB
  const result = queries.addSubmission.run(
    sessionId, user.id, fileName,
    chatSession.problem_unit, chatSession.problem_name
  );
  const submissionId = result.lastInsertRowid;

  // 로컬 자동 저장 (문제별/학번별 - 덮어쓰기)
  const localFileName = `${user.student_id}.html`;
  saveToLocal('submit', chatSession.problem_unit, chatSession.problem_name, user.student_id, localFileName, htmlContent);

  // 대화로그 저장 (제출한 세션의 로그만, 같은 문제 이전 로그는 덮어쓰기)
  saveChatLog(sessionId);

  res.json({ success: true, fileName });
});

app.get('/api/submissions', requireAuth, (req, res) => {
  const submissions = queries.getUserSubmissions.all(req.session.userId);
  res.json(submissions);
});

// Student download own submission HTML
app.get('/api/submissions/:id/download', requireAuth, (req, res) => {
  const sub = queries.getSubmission.get(req.params.id);
  if (!sub || sub.user_id !== req.session.userId) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const filePath = path.join(__dirname, 'uploads', sub.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일이 존재하지 않습니다.' });
  res.download(filePath, `${sub.problem_unit}_${sub.problem_name}.html`);
});

// Student preview own submission HTML
app.get('/api/submissions/:id/preview', requireAuth, (req, res) => {
  const sub = queries.getSubmission.get(req.params.id);
  if (!sub || sub.user_id !== req.session.userId) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const filePath = path.join(__dirname, 'uploads', sub.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일이 존재하지 않습니다.' });
  res.type('html').sendFile(filePath);
});

// Student view chat log of submitted session
app.get('/api/submissions/:id/log', requireAuth, (req, res) => {
  const sub = queries.getSubmission.get(req.params.id);
  if (!sub || sub.user_id !== req.session.userId) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const messages = queries.getSessionMessages.all(sub.session_id);
  res.json({ session: queries.getSession.get(sub.session_id), messages });
});

// ── Time check API (for client polling) ─────────────────
app.get('/api/time-check/:sessionId', requireAuth, (req, res) => {
  const user = queries.getUserById.get(req.session.userId);
  const sessions = queries.getUserSessions.all(user.id);
  const sessionIndex = sessions.findIndex(s => s.id === parseInt(req.params.sessionId));
  const sessionNumber = sessions.length - sessionIndex;
  const timeCheck = isWithinTimeRestriction(user, sessionNumber);
  res.json(timeCheck);
});

// ── Admin API ───────────────────────────────────────────
// Students list
app.get('/api/admin/students', requireAdmin, (req, res) => {
  const students = queries.getAllStudents.all();
  const result = students.map(s => {
    const sessionCount = queries.getStudentSessionCount.get(s.id).cnt;
    const maxSessions = getEffectiveSessionLimit(s);
    return { ...s, sessionCount, maxSessions };
  });
  res.json(result);
});

// Session limits
app.get('/api/admin/session-limits', requireAdmin, (req, res) => {
  res.json(queries.getAllSessionLimits.all());
});

app.post('/api/admin/session-limits', requireAdmin, (req, res) => {
  const { targetType, targetId, maxSessions } = req.body;
  // Check if limit exists for this target
  const existing = queries.getSessionLimit.get(targetType, targetId);
  if (existing) {
    db.prepare('UPDATE session_limits SET max_sessions = ?, updated_at = datetime("now") WHERE id = ?')
      .run(maxSessions, existing.id);
  } else {
    db.prepare('INSERT INTO session_limits (target_type, target_id, max_sessions) VALUES (?, ?, ?)')
      .run(targetType, targetId, maxSessions);
  }
  res.json({ success: true });
});

app.delete('/api/admin/session-limits/:id', requireAdmin, (req, res) => {
  queries.deleteSessionLimit.run(req.params.id);
  res.json({ success: true });
});

// Time restrictions
app.get('/api/admin/time-restrictions', requireAdmin, (req, res) => {
  res.json(queries.getAllTimeRestrictions.all());
});

app.post('/api/admin/time-restrictions', requireAdmin, (req, res) => {
  const { targetType, targetId, sessionNumber, maxSessions, date, startTime, endTime } = req.body;
  queries.addTimeRestriction.run(targetType, targetId, sessionNumber || null, maxSessions || null, date, startTime, endTime);
  res.json({ success: true });
});

app.put('/api/admin/time-restrictions/:id', requireAdmin, (req, res) => {
  const { targetType, targetId, sessionNumber, maxSessions, date, startTime, endTime } = req.body;
  queries.updateTimeRestriction.run(targetType, targetId, sessionNumber || null, maxSessions || null, date, startTime, endTime, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/time-restrictions/:id', requireAdmin, (req, res) => {
  queries.deleteTimeRestriction.run(req.params.id);
  res.json({ success: true });
});

// Submissions
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  res.json(queries.getAllSubmissions.all());
});

app.get('/api/admin/download/:id', requireAdmin, (req, res) => {
  const sub = queries.getSubmission.get(req.params.id);
  if (!sub) return res.status(404).json({ error: '제출물을 찾을 수 없습니다.' });
  const filePath = path.join(__dirname, 'uploads', sub.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일이 존재하지 않습니다.' });
  res.download(filePath);
});

app.get('/api/admin/preview/:id', requireAdmin, (req, res) => {
  const sub = queries.getSubmission.get(req.params.id);
  if (!sub) return res.status(404).json({ error: '제출물을 찾을 수 없습니다.' });
  const filePath = path.join(__dirname, 'uploads', sub.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일이 존재하지 않습니다.' });
  res.type('html').sendFile(filePath);
});

// Chat logs
app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  const { classNum, studentId } = req.query;
  if (studentId) {
    const user = queries.getUserByStudentId.get(studentId);
    if (!user) return res.json([]);
    res.json(queries.getUserSessions.all(user.id));
  } else if (classNum) {
    res.json(queries.getSessionsByClass.all(parseInt(classNum)));
  } else {
    const all = db.prepare(`
      SELECT cs.*, u.student_id, u.class_num, u.student_num
      FROM chat_sessions cs JOIN users u ON cs.user_id = u.id
      ORDER BY cs.created_at DESC
    `).all();
    res.json(all);
  }
});

app.get('/api/admin/logs/:sessionId', requireAdmin, (req, res) => {
  const messages = queries.getSessionMessages.all(parseInt(req.params.sessionId));
  const session = queries.getSession.get(parseInt(req.params.sessionId));
  res.json({ session, messages });
});

// Admin password reset for student
app.post('/api/admin/reset-password', requireAdmin, (req, res) => {
  const { studentId } = req.body;
  const user = queries.getUserByStudentId.get(studentId);
  if (!user) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
  queries.setPassword.run(null, user.id);
  res.json({ success: true });
});

// ── Start ───────────────────────────────────────────────
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let localIp = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }
  console.log(`\n🚀 서버 실행 중! (로컬: http://localhost:${PORT})`);
});
