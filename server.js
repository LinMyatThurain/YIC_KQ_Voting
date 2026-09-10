import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createPostgresVoteStore } from './postgres-store.js';

const PORT = Number(process.env.PORT || 3000);
const APP_ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const DATABASE_PATH = process.env.DATABASE_PATH || './votes.db';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'uzawlin';
const TEST_ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || 'test-admin';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'testadmin';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@yic';
const ADMIN_SESSIONS = new Set();
const MAX_JSON_BODY_LENGTH = 5 * 1024 * 1024;
const SEEDED_CANDIDATES = [
  ...['Aiden Cole', 'Noah James', 'Liam Brooks', 'Ethan King', 'Leo Grant']
    .map((name) => ({ name, category: 'HND', gender: 'King', subtitle: 'HND candidate' })),
  { name: 'Kyi Nue Wai', category: 'HND', gender: 'Queen', imageUrl: 'images/YIC Day Event (Queen)/Kyi Nue Wai HND Computing Batch(40) Queen.jpg', subtitle: 'HND Computing · Batch 40' },
  { name: 'Yoon Ya Mone Naing', category: 'HND', gender: 'Queen', imageUrl: 'images/YIC Day Event (Queen)/Yoon Ya Mone Naing HND Business Batch(18) Queen.jpg', subtitle: 'HND Business · Batch 18' },
  { name: 'Thiri Khit', category: 'HND', gender: 'Queen', imageUrl: 'images/YIC Day Event (Queen)/Thiri Khit HND Computing Batch(40)Queen.jpg', subtitle: 'HND Computing · Batch 40' },
  { name: 'Thet Hsu Naing', category: 'HND', gender: 'Queen', imageUrl: 'images/YIC Day Event (Queen)/Thet Hsu Naing HND Computing Batch(39) Queen.jpg', subtitle: 'HND Computing · Batch 39' },
  { name: 'Su Myat Phyu Sin', category: 'HND', gender: 'Queen', imageUrl: 'images/YIC Day Event (Queen)/Su Myat Phyu Sin HND Business(18)Queen.jpg', subtitle: 'HND Business · Batch 18' },
  ...Array.from({ length: 6 }, (_, index) => ({
    name: `IGCSE/GED King ${String(index + 1).padStart(2, '0')}`,
    category: 'IGCSE/GED',
    gender: 'King',
    subtitle: 'IGCSE / GED candidate'
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    name: `IGCSE/GED Queen ${String(index + 1).padStart(2, '0')}`,
    category: 'IGCSE/GED',
    gender: 'Queen',
    subtitle: 'IGCSE / GED candidate'
  }))
];

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createCurrentVotesTable(database, tableName = 'votes') {
  database.exec(`
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      batch TEXT,
      hnd_king TEXT,
      hnd_queen TEXT,
      ged_king TEXT,
      ged_queen TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function createCandidatesTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('HND', 'IGCSE/GED')),
      gender TEXT NOT NULL CHECK (gender IN ('King', 'Queen')),
      image_url TEXT,
      subtitle TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (name, category, gender)
    )
  `);
}

function createSettingsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      started_at TEXT,
      state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0)
    )
  `);
  const columns = new Set(database.prepare('PRAGMA table_info(settings)').all().map((column) => column.name));
  if (!columns.has('started_at')) database.exec('ALTER TABLE settings ADD COLUMN started_at TEXT');
  if (!columns.has('state_version')) database.exec('ALTER TABLE settings ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0');
  database.prepare(`
    INSERT INTO settings (key, value, started_at, state_version)
    VALUES ('voting', 'false', NULL, 0)
    ON CONFLICT(key) DO UPDATE SET
      started_at = COALESCE(settings.started_at, excluded.started_at),
      state_version = COALESCE(settings.state_version, excluded.state_version)
  `).run();
}

function seedCandidates(database) {
  if (database.prepare('SELECT COUNT(*) AS count FROM candidates').get().count > 0) return;

  const insert = database.prepare(`
    INSERT INTO candidates (name, category, gender, image_url, subtitle)
    VALUES (?, ?, ?, ?, ?)
  `);
  database.transaction(() => {
    for (const candidate of SEEDED_CANDIDATES) {
      insert.run(
        candidate.name,
        candidate.category,
        candidate.gender,
        candidate.imageUrl || null,
        candidate.subtitle || null
      );
    }
  })();
}

function serializeCandidate(candidate) {
  if (!candidate) return candidate;
  return { ...candidate, active: Boolean(candidate.active) };
}

function migrateVotesTable(database) {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'votes'"
  ).get();
  if (!table) {
    createCurrentVotesTable(database);
    return;
  }

  const columns = database.prepare('PRAGMA table_info(votes)').all().map((column) => column.name);
  const requiredColumns = ['hnd_king', 'hnd_queen', 'ged_king', 'ged_queen'];
  const hasLegacyConstraint = String(table.sql || '').toLowerCase().includes('couple_id');
  if (!hasLegacyConstraint && requiredColumns.every((column) => columns.includes(column))) return;

  const sourceColumns = new Set(columns);
  const selectColumn = (column) => sourceColumns.has(column) ? column : 'NULL';
  const legacyRows = database.prepare(`
    SELECT
      id,
      email,
      ${selectColumn('name')} AS name,
      ${selectColumn('batch')} AS batch,
      ${selectColumn('hnd_king')} AS hnd_king,
      ${selectColumn('hnd_queen')} AS hnd_queen,
      ${selectColumn('ged_king')} AS ged_king,
      ${selectColumn('ged_queen')} AS ged_queen,
      ${selectColumn('king')} AS legacy_king,
      ${selectColumn('queen')} AS legacy_queen,
      ${selectColumn('created_at')} AS created_at
    FROM votes
    ORDER BY id ASC
  `).all();

  const migrate = database.transaction(() => {
    createCurrentVotesTable(database, 'votes_new');
    const insert = database.prepare(`
      INSERT INTO votes_new (
        id, email, name, batch, hnd_king, hnd_queen, ged_king, ged_queen, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of legacyRows) {
      insert.run(
        row.id,
        row.email,
        row.name,
        row.batch,
        row.hnd_king || row.legacy_king || null,
        row.hnd_queen || row.legacy_queen || null,
        row.ged_king || null,
        row.ged_queen || null,
        row.created_at
      );
    }
    database.exec('DROP TABLE votes');
    database.exec('ALTER TABLE votes_new RENAME TO votes');
  });
  migrate();
}

export function createVoteStore(databasePath = DATABASE_PATH) {
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  createCandidatesTable(database);
  createSettingsTable(database);
  seedCandidates(database);
  migrateVotesTable(database);

  const insertVote = database.prepare(
    `INSERT INTO votes (email, name, batch, hnd_king, hnd_queen, ged_king, ged_queen)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  return {
    getCandidates({ activeOnly = true } = {}) {
      const where = activeOnly ? 'WHERE active = 1' : '';
      return database.prepare(`
        SELECT id, name, category, gender, image_url AS imageUrl,
          subtitle, active, created_at AS createdAt, updated_at AS updatedAt
        FROM candidates ${where}
        ORDER BY category, gender, id
      `).all().map((candidate) => ({
        ...candidate,
        active: Boolean(candidate.active)
      }));
    },
    getVotingState() {
      const state = database.prepare(`
        SELECT value, started_at AS startedAt, state_version AS stateVersion
        FROM settings WHERE key = 'voting'
      `).get();
      return {
        voting: state.value === 'true',
        startedAt: state.startedAt ? new Date(`${state.startedAt}Z`).toISOString() : null,
        stateVersion: Number(state.stateVersion || 0)
      };
    },
    setVotingState(enabled = false) {
      const current = database.prepare(`
        SELECT value, started_at AS startedAt, state_version AS stateVersion
        FROM settings WHERE key = 'voting'
      `).get();
      const currentlyOpen = current.value === 'true';
      if (currentlyOpen === enabled) return this.getVotingState();
      database.prepare(`
        UPDATE settings
        SET value = ?, started_at = ?, state_version = state_version + 1
        WHERE key = 'voting'
      `).run(enabled ? 'true' : 'false', enabled ? new Date().toISOString().replace('Z', '') : null);
      return this.getVotingState();
    },
    createCandidate(candidate = {}) {
      const name = String(candidate.name || '').trim();
      const category = String(candidate.category || '').trim();
      const gender = String(candidate.gender || '').trim();
      const imageUrl = String(candidate.imageUrl ?? candidate.imagePath ?? candidate.image ?? '').trim() || null;
      const subtitle = String(candidate.subtitle || '').trim() || null;
      if (!name || !['HND', 'IGCSE/GED'].includes(category) || !['King', 'Queen'].includes(gender)) {
        throw new Error('A candidate name, category, and gender are required.');
      }
      const existing = database.prepare(`
        SELECT id, active, image_url AS imageUrl, subtitle
        FROM candidates WHERE name = ? AND category = ? AND gender = ?
      `).get(name, category, gender);
      if (existing) {
        if (existing.active) {
          const error = new Error('A candidate with these details already exists.');
          error.code = 'SQLITE_CONSTRAINT_UNIQUE';
          throw error;
        }
        database.prepare(`
          UPDATE candidates
          SET image_url = ?, subtitle = ?, active = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(imageUrl || existing.imageUrl, subtitle || existing.subtitle, existing.id);
        return serializeCandidate(database.prepare(`
          SELECT id, name, category, gender, image_url AS imageUrl, subtitle, active
          FROM candidates WHERE id = ?
        `).get(existing.id));
      }
      const result = database.prepare(`
        INSERT INTO candidates (name, category, gender, image_url, subtitle)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, category, gender, imageUrl, subtitle);
      return serializeCandidate(database.prepare(`
        SELECT id, name, category, gender, image_url AS imageUrl, subtitle, active
        FROM candidates WHERE id = ?
      `).get(result.lastInsertRowid));
    },
    updateCandidate(id, changes = {}) {
      const current = database.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(id));
      if (!current) return null;
      const candidate = {
        name: changes.name === undefined ? current.name : String(changes.name || '').trim(),
        category: changes.category === undefined ? current.category : String(changes.category || '').trim(),
        gender: changes.gender === undefined ? current.gender : String(changes.gender || '').trim(),
        imageUrl: changes.imageUrl === undefined && changes.imagePath === undefined && changes.image === undefined
          ? current.image_url
          : String(changes.imageUrl ?? changes.imagePath ?? changes.image ?? '').trim() || null,
        subtitle: changes.subtitle === undefined
          ? current.subtitle
          : String(changes.subtitle || '').trim() || null
      };
      if (!candidate.name || !['HND', 'IGCSE/GED'].includes(candidate.category)
        || !['King', 'Queen'].includes(candidate.gender)) {
        throw new Error('A candidate name, category, and gender are required.');
      }
      database.prepare(`
        UPDATE candidates
        SET name = ?, category = ?, gender = ?, image_url = ?, subtitle = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(candidate.name, candidate.category, candidate.gender, candidate.imageUrl, candidate.subtitle, Number(id));
      return serializeCandidate(database.prepare(`
        SELECT id, name, category, gender, image_url AS imageUrl, subtitle, active
        FROM candidates WHERE id = ?
      `).get(Number(id)));
    },
    deleteCandidate(id) {
      return database.prepare(
        'DELETE FROM candidates WHERE id = ?'
      ).run(Number(id)).changes > 0;
    },
    clearVotes() {
      return database.prepare('DELETE FROM votes').run().changes;
    },
    recordVote(vote = {}, { allowRepeat = false } = {}) {
      const { email, name, batch, hndKing, hndQueen, gedKing, gedQueen } = vote || {};
      const normalizedEmail = normalizeEmail(email);
      const normalizedName = String(name || '').trim();
      const normalizedBatch = String(batch || '').trim();
      const isActiveCandidate = (candidateName, category, gender) => Boolean(database.prepare(`
        SELECT 1 FROM candidates
        WHERE name = ? AND category = ? AND gender = ? AND active = 1
      `).get(candidateName, category, gender));
      if (
        !normalizedEmail
        || !normalizedName
        || !normalizedBatch
        || !isActiveCandidate(hndKing, 'HND', 'King')
        || !isActiveCandidate(hndQueen, 'HND', 'Queen')
        || !isActiveCandidate(gedKing, 'IGCSE/GED', 'King')
        || !isActiveCandidate(gedQueen, 'IGCSE/GED', 'Queen')
      ) {
        return { accepted: false, reason: 'invalid_request' };
      }

      try {
        if (allowRepeat) {
          database.prepare(
            `INSERT INTO votes (email, name, batch, hnd_king, hnd_queen, ged_king, ged_queen)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            `${normalizedEmail}#test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            normalizedName,
            normalizedBatch,
            hndKing,
            hndQueen,
            gedKing,
            gedQueen
          );
        } else {
          insertVote.run(
            normalizedEmail,
            normalizedName,
            normalizedBatch,
            hndKing,
            hndQueen,
            gedKing,
            gedQueen
          );
        }
        return { accepted: true };
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
          return { accepted: false, reason: 'already_voted' };
        }
        throw error;
      }
    },
    getResults() {
      const voters = database.prepare(
        `SELECT
          name, email, batch,
          hnd_king AS hndKing,
          hnd_queen AS hndQueen,
          ged_king AS gedKing,
          ged_queen AS gedQueen
        FROM votes ORDER BY id ASC`
      ).all().map((voter) => ({
        ...voter,
        email: voter.email.replace(/#test-[^-]+-[a-z0-9]+$/i, ''),
        king: voter.hndKing,
        queen: voter.hndQueen
      }));
      const count = (column) => Object.fromEntries(database.prepare(
        `SELECT ${column} AS candidate, COUNT(*) AS votes
         FROM votes
         WHERE ${column} IS NOT NULL
         GROUP BY ${column}
         ORDER BY ${column}`
      ).all().map(({ candidate, votes }) => [candidate, votes]));
      const hndKings = count('hnd_king');
      const hndQueens = count('hnd_queen');
      const gedKings = count('ged_king');
      const gedQueens = count('ged_queen');

      return {
        total: voters.length,
        kings: hndKings,
        queens: hndQueens,
        hndKings,
        hndQueens,
        gedKings,
        gedQueens,
        voters
      };
    },
    close() {
      database.close();
    }
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_JSON_BODY_LENGTH) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function isAdminAuthorized(request) {
  const authorization = request.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return ADMIN_SESSIONS.has(authorization.slice(7));
  }
  if (!authorization.startsWith('Basic ')) return false;

  try {
    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    return separator >= 0
      && credentials.slice(0, separator) === 'admin'
      && credentials.slice(separator + 1) === ADMIN_PASSWORD;
  } catch {
    return false;
  }

}

function isTestAdminAuthorized(request) {
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) return false;

  try {
    const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    return separator >= 0
      && credentials.slice(0, separator) === TEST_ADMIN_USERNAME
      && credentials.slice(separator + 1) === TEST_ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

export function createServer(store = process.env.DATABASE_URL ? createPostgresVoteStore() : createVoteStore()) {
  return http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
      });
      response.end();
      return;
    }

    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      try {
        const body = await readJson(request);
        if (String(body.email || '').trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          sendJson(response, 401, { error: 'Invalid admin email.' });
          return;
        }
        const token = `${Date.now().toString(36)}-${randomUUID()}`;
        ADMIN_SESSIONS.add(token);
        sendJson(response, 200, { token });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (request.method === 'DELETE' && url.pathname === '/api/admin/votes') {
      if (!isAdminAuthorized(request)) {
        response.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="Voting admin"',
          'Access-Control-Allow-Origin': '*'
        });
        response.end(JSON.stringify({ error: 'Admin authentication required.' }));
        return;
      }

      sendJson(response, 200, { deleted: await store.clearVotes() });
      return;
    }

    const candidateMatch = url.pathname.match(/^\/api\/(?:admin\/)?candidates(?:\/(\d+))?$/);
    const isCandidateAdminRoute = candidateMatch && (
      request.method !== 'GET' || url.pathname.startsWith('/api/admin/')
    );

    if (request.method === 'GET' && url.pathname === '/api/candidates/public') {
      sendJson(response, 200, await store.getCandidates());
      return;
    }

    if (candidateMatch && (request.method === 'GET' || isCandidateAdminRoute)) {
      if (!isAdminAuthorized(request)) {
        response.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="Voting admin"',
          'Access-Control-Allow-Origin': '*'
        });
        response.end(JSON.stringify({ error: 'Admin authentication required.' }));
        return;
      }

      try {
        if (request.method === 'GET') {
          sendJson(response, 200, await store.getCandidates({
            activeOnly: !url.pathname.startsWith('/api/admin/')
          }));
          return;
        }
        if (request.method === 'POST' && !candidateMatch[1]) {
          const candidate = await store.createCandidate(await readJson(request));
          sendJson(response, 201, candidate);
          return;
        }
        if (request.method === 'PATCH' && candidateMatch[1]) {
          const candidate = await store.updateCandidate(candidateMatch[1], await readJson(request));
          if (!candidate) {
            sendJson(response, 404, { error: 'Candidate not found.' });
            return;
          }
          sendJson(response, 200, candidate);
          return;
        }
        if (request.method === 'DELETE' && candidateMatch[1]) {
          if (!await store.deleteCandidate(candidateMatch[1])) {
            sendJson(response, 404, { error: 'Candidate not found.' });
            return;
          }
          response.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          response.end();
          return;
        }
        sendJson(response, 405, { error: 'Method not allowed.' });
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          sendJson(response, 409, { error: 'An active candidate with these details already exists.' });
          return;
        }
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/results') {
      if (!isAdminAuthorized(request)) {
        response.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="Voting admin"',
          'Access-Control-Allow-Origin': '*'
        });
        response.end(JSON.stringify({ error: 'Admin authentication required.' }));
        return;
      }

      sendJson(response, 200, await store.getResults());
      return;
    }

    // Public voting state endpoint (used by voting page to know if voting is open)
    if (request.method === 'GET' && url.pathname === '/api/voting') {
      sendJson(response, 200, await store.getVotingState());
      return;
    }

    // Admin control to start/stop voting
    if (request.method === 'POST' && url.pathname === '/api/admin/voting') {
      if (!isAdminAuthorized(request)) {
        response.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="Voting admin"',
          'Access-Control-Allow-Origin': '*'
        });
        response.end(JSON.stringify({ error: 'Admin authentication required.' }));
        return;
      }
      try {
        const body = await readJson(request);
        const action = String(body.action || '').toLowerCase();
        if (action === 'start') {
          sendJson(response, 200, await store.setVotingState(true));
          return;
        }
        if (action === 'stop') {
          sendJson(response, 200, await store.setVotingState(false));
          return;
        }
        sendJson(response, 400, { error: 'Invalid action. Use "start" or "stop".' });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/test-admin/verify') {
      if (!isTestAdminAuthorized(request)) {
        sendJson(response, 401, { error: 'Test admin authentication required.' });
        return;
      }
      sendJson(response, 200, { authenticated: true });
      return;
    }

    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = resolve(APP_ROOT, `.${requestedPath}`);
      if (filePath !== APP_ROOT && !filePath.startsWith(`${APP_ROOT}${sep}`)) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      try {
        const content = await readFile(filePath);
        response.writeHead(200, {
          'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        response.end(content);
      } catch {
        sendJson(response, 404, { error: 'Not found' });
      }
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/api/votes') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    try {
      const isTestAdmin = isTestAdminAuthorized(request);
      const votingState = await store.getVotingState();
      if (!votingState.voting && !isTestAdmin) {
        sendJson(response, 403, { error: 'Voting is not open.' });
        return;
      }
      const result = await store.recordVote(await readJson(request), { allowRepeat: isTestAdmin });
      if (result.reason === 'invalid_request') {
        sendJson(response, 400, {
          error: 'A valid email, voter details, one HND pair, and one IGCSE/GED pair are required.'
        });
        return;
      }
      if (result.reason === 'already_voted') {
        sendJson(response, 409, { error: 'This email address has already voted.' });
        return;
      }
      sendJson(response, 201, { message: 'Vote recorded.' });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  createServer().listen(PORT, () => {
    console.log(`Voting API listening on port ${PORT}`);
  });
}
