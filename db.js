const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


// ── Schema ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT DEFAULT 'student',
    class_num INTEGER,
    student_num INTEGER
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    problem_unit TEXT NOT NULL,
    problem_name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES chat_sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES chat_sessions(id),
    user_id INTEGER REFERENCES users(id),
    file_path TEXT NOT NULL,
    problem_unit TEXT NOT NULL,
    problem_name TEXT NOT NULL,
    submitted_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS session_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    max_sessions INTEGER NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS time_restrictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    session_number INTEGER,
    max_sessions INTEGER,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );
`);

// Migration: add max_sessions to older DBs that predate the column.
// Runs AFTER schema creation, so a fresh DB (which already has the column via
// CREATE TABLE above) doesn't trip on a not-yet-existing table.
try {
  db.prepare('SELECT max_sessions FROM time_restrictions LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE time_restrictions ADD COLUMN max_sessions INTEGER');
}

// ── Seed accounts ───────────────────────────────────────
function seedAccounts() {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (existing.cnt > 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO users (student_id, password_hash, role, class_num, student_num) VALUES (?, ?, ?, ?, ?)'
  );

  // 시드 규모는 .env 로 조정 (기본: 5개 반 × 반당 20명)
  const SEED_CLASSES = parseInt(process.env.SEED_CLASSES, 10) || 5;
  const SEED_STUDENTS_PER_CLASS = parseInt(process.env.SEED_STUDENTS_PER_CLASS, 10) || 20;

  // 관리자 계정은 .env 로 설정. 미설정 시 기본값을 쓰고 경고를 출력한다.
  const ADMIN_ID = process.env.ADMIN_ID || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[보안 경고] ADMIN_PASSWORD 가 .env 에 설정되지 않아 기본 비밀번호를 사용합니다. 반드시 변경하세요!');
  }

  const seedMany = db.transaction(() => {
    // 학생 계정 자동 생성: 학번 = 1{반}{번호 2자리} (예: 1반 1번 → 1101, 3반 17번 → 1317)
    for (let cls = 1; cls <= SEED_CLASSES; cls++) {
      for (let num = 1; num <= SEED_STUDENTS_PER_CLASS; num++) {
        const studentId = `1${cls}${String(num).padStart(2, '0')}`;
        insert.run(studentId, null, 'student', cls, num);
      }
    }

    // 관리자 계정
    const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    insert.run(ADMIN_ID, adminHash, 'admin', null, null);
  });

  seedMany();
}

seedAccounts();

// ── Helpers ─────────────────────────────────────────────
const queries = {
  getUserByStudentId: db.prepare('SELECT * FROM users WHERE student_id = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),

  createSession: db.prepare(
    'INSERT INTO chat_sessions (user_id, problem_unit, problem_name) VALUES (?, ?, ?)'
  ),
  getSession: db.prepare('SELECT * FROM chat_sessions WHERE id = ?'),
  getUserSessions: db.prepare(
    'SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC'
  ),
  endSession: db.prepare("UPDATE chat_sessions SET status = 'ended' WHERE id = ?"),

  addMessage: db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
  ),
  getSessionMessages: db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ),

  addSubmission: db.prepare(
    'INSERT INTO submissions (session_id, user_id, file_path, problem_unit, problem_name) VALUES (?, ?, ?, ?, ?)'
  ),
  getUserSubmissions: db.prepare(
    'SELECT * FROM submissions WHERE user_id = ? ORDER BY submitted_at DESC'
  ),
  getSubmission: db.prepare('SELECT * FROM submissions WHERE id = ?'),
  getPreviousSubmissions: db.prepare(
    'SELECT * FROM submissions WHERE user_id = ? AND problem_unit = ? AND problem_name = ?'
  ),
  deleteSubmission: db.prepare('DELETE FROM submissions WHERE id = ?'),
  getAllSubmissions: db.prepare(`
    SELECT s.*, u.student_id, u.class_num, u.student_num
    FROM submissions s JOIN users u ON s.user_id = u.id
    ORDER BY s.submitted_at DESC
  `),

  // Session limits
  getSessionLimit: db.prepare(
    'SELECT * FROM session_limits WHERE target_type = ? AND target_id = ?'
  ),
  upsertSessionLimit: db.prepare(`
    INSERT INTO session_limits (target_type, target_id, max_sessions, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET max_sessions = excluded.max_sessions, updated_at = datetime('now')
  `),
  getAllSessionLimits: db.prepare('SELECT * FROM session_limits ORDER BY target_type, target_id'),
  deleteSessionLimit: db.prepare('DELETE FROM session_limits WHERE id = ?'),
  setSessionLimit: db.prepare(
    `INSERT INTO session_limits (target_type, target_id, max_sessions)
     VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`
  ),

  // Time restrictions
  addTimeRestriction: db.prepare(
    'INSERT INTO time_restrictions (target_type, target_id, session_number, max_sessions, date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  getTimeRestrictions: db.prepare(
    'SELECT * FROM time_restrictions WHERE target_type = ? AND target_id = ?'
  ),
  getAllTimeRestrictions: db.prepare('SELECT * FROM time_restrictions ORDER BY date, start_time'),
  updateTimeRestriction: db.prepare(
    'UPDATE time_restrictions SET target_type=?, target_id=?, session_number=?, max_sessions=?, date=?, start_time=?, end_time=? WHERE id=?'
  ),
  deleteTimeRestriction: db.prepare('DELETE FROM time_restrictions WHERE id = ?'),

  // Admin queries
  getAllStudents: db.prepare(
    "SELECT id, student_id, class_num, student_num, password_hash IS NOT NULL as has_password FROM users WHERE role = 'student' ORDER BY class_num, student_num"
  ),
  getStudentSessionCount: db.prepare(
    'SELECT COUNT(*) as cnt FROM chat_sessions WHERE user_id = ?'
  ),
  getSessionsByClass: db.prepare(`
    SELECT cs.*, u.student_id, u.student_num
    FROM chat_sessions cs JOIN users u ON cs.user_id = u.id
    WHERE u.class_num = ?
    ORDER BY cs.created_at DESC
  `),
};

// Get effective session limit for a user
function getEffectiveSessionLimit(user) {
  // 1. 개별 학생 제한이 있으면 최우선
  const studentLimit = queries.getSessionLimit.get('student', user.student_id);
  if (studentLimit) return studentLimit.max_sessions;

  // 2. 현재 활성 시간 블록의 max_sessions 확인
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kst.toISOString().split('T')[0];
  const currentTime = kst.toISOString().split('T')[1].substring(0, 5);

  const classRestrictions = queries.getTimeRestrictions.all('class', String(user.class_num));
  const studentRestrictions = queries.getTimeRestrictions.all('student', user.student_id);
  const allRestrictions = [...studentRestrictions, ...classRestrictions];

  for (const r of allRestrictions) {
    if (r.date !== todayStr) continue;
    if (currentTime >= r.start_time && currentTime <= r.end_time && r.max_sessions) {
      return r.max_sessions;
    }
  }

  // 3. 오늘 시간 블록이 있지만 현재 활성이 아닌 경우, 가장 큰 max_sessions 반환
  const todayBlocks = allRestrictions.filter(r => r.date === todayStr && r.max_sessions);
  if (todayBlocks.length > 0) {
    return Math.max(...todayBlocks.map(r => r.max_sessions));
  }

  // 4. 반 전체 세션 제한 (레거시 호환)
  const classLimit = queries.getSessionLimit.get('class', String(user.class_num));
  if (classLimit) return classLimit.max_sessions;

  // 5. 기본: 무제한
  return 999;
}

// Check if current time is within allowed time restrictions
function isWithinTimeRestriction(user, sessionNumber) {
  // Get current KST time
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kst.toISOString().split('T')[0];
  const currentTime = kst.toISOString().split('T')[1].substring(0, 5);

  // Check student-level restrictions
  const studentRestrictions = queries.getTimeRestrictions.all('student', user.student_id);
  // Check class-level restrictions
  const classRestrictions = queries.getTimeRestrictions.all('class', String(user.class_num));

  const allRestrictions = [...studentRestrictions, ...classRestrictions];

  // If no restrictions exist, allow access
  if (allRestrictions.length === 0) return { allowed: true };

  // Find matching restrictions for today and session number
  for (const r of allRestrictions) {
    if (r.date !== todayStr) continue;
    if (r.session_number !== null && r.session_number !== sessionNumber) continue;
    if (currentTime >= r.start_time && currentTime <= r.end_time) {
      return { allowed: true, endTime: `${r.date} ${r.end_time}` };
    }
  }

  // Find next available slot today
  const todaySlots = allRestrictions
    .filter(r => r.date === todayStr && (r.session_number === null || r.session_number === sessionNumber))
    .filter(r => currentTime < r.start_time);

  if (todaySlots.length > 0) {
    const next = todaySlots.sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    return { allowed: false, reason: `이용 가능 시간: ${next.start_time} ~ ${next.end_time}` };
  }

  return { allowed: false, reason: '오늘 이용 가능한 시간이 없습니다.' };
}

module.exports = { db, queries, getEffectiveSessionLimit, isWithinTimeRestriction };
