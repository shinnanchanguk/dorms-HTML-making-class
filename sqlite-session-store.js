// SQLite 기반 express-session 저장소 (외부 의존성 없음, better-sqlite3 재사용)
// 서버를 재시작해도 로그인 세션이 유지된다. 만료된 세션은 주기적으로 정리.

module.exports = function createSqliteSessionStore(session, db) {
  const Store = session.Store;

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid    TEXT PRIMARY KEY,
      sess   TEXT NOT NULL,
      expire INTEGER NOT NULL
    );
  `);

  const stmts = {
    get: db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?'),
    upsert: db.prepare(`
      INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
    `),
    destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
    touch: db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?'),
    cleanup: db.prepare('DELETE FROM sessions WHERE expire < ?'),
  };

  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // cookie.maxAge 없을 때 기본 1일

  function expireAt(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return Date.now() + DEFAULT_TTL_MS;
  }

  class SqliteStore extends Store {
    get(sid, cb) {
      try {
        const row = stmts.get.get(sid);
        if (!row) return cb(null, null);
        if (row.expire < Date.now()) {
          stmts.destroy.run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.sess));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        stmts.upsert.run(sid, JSON.stringify(sess), expireAt(sess));
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        stmts.destroy.run(sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    touch(sid, sess, cb) {
      try {
        stmts.touch.run(expireAt(sess), sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }
  }

  const store = new SqliteStore();

  // 만료 세션 정리: 시작 시 1회 + 1시간마다
  const purge = () => {
    try { stmts.cleanup.run(Date.now()); } catch (_) {}
  };
  purge();
  const timer = setInterval(purge, 60 * 60 * 1000);
  if (timer.unref) timer.unref();

  return store;
};
