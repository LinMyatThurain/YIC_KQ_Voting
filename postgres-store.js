import pg from 'pg';

const { Pool } = pg;

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

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const serializeCandidate = (candidate) => candidate && ({ ...candidate, active: Boolean(candidate.active) });

export function createPostgresVoteStore(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: { rejectUnauthorized: false } });
  const ready = initialize(pool);
  const withReady = (operation) => ready.then(() => operation());

  return {
    getCandidates({ activeOnly = true } = {}) {
      return withReady(async () => {
        const result = await pool.query(`
          SELECT id, name, category, gender, image_url AS "imageUrl",
            subtitle, active, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM candidates ${activeOnly ? 'WHERE active = TRUE' : ''}
          ORDER BY category, gender, id
        `);
        return result.rows.map(serializeCandidate);
      });
    },

    // Voting state stored in settings.key = 'voting' with value 'true' or 'false'
    getVotingState() {
      return withReady(async () => {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'voting'");
        if (!result.rows[0]) return false;
        return result.rows[0].value === 'true';
      });
    },

    setVotingState(enabled = false) {
      return withReady(async () => {
        const val = enabled ? 'true' : 'false';
        await pool.query(`
          INSERT INTO settings (key, value) VALUES ('voting', $1)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [val]);
        return enabled;
      });
    },
    createCandidate(candidate = {}) {
      return withReady(async () => {
        const name = String(candidate.name || '').trim();
        const category = String(candidate.category || '').trim();
        const gender = String(candidate.gender || '').trim();
        const imageUrl = String(candidate.imageUrl ?? candidate.imagePath ?? candidate.image ?? '').trim() || null;
        const subtitle = String(candidate.subtitle || '').trim() || null;
        if (!name || !['HND', 'IGCSE/GED'].includes(category) || !['King', 'Queen'].includes(gender)) {
          throw new Error('A candidate name, category, and gender are required.');
        }
        const existing = await pool.query(
          'SELECT id, active, image_url AS "imageUrl", subtitle FROM candidates WHERE name = $1 AND category = $2 AND gender = $3',
          [name, category, gender]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].active) {
            const error = new Error('A candidate with these details already exists.');
            error.code = 'SQLITE_CONSTRAINT_UNIQUE';
            throw error;
          }
          const restored = await pool.query(`
            UPDATE candidates SET image_url = $1, subtitle = $2, active = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING id, name, category, gender, image_url AS "imageUrl", subtitle, active
          `, [imageUrl || existing.rows[0].imageUrl, subtitle || existing.rows[0].subtitle, existing.rows[0].id]);
          return serializeCandidate(restored.rows[0]);
        }
        const inserted = await pool.query(`
          INSERT INTO candidates (name, category, gender, image_url, subtitle)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name, category, gender, image_url AS "imageUrl", subtitle, active
        `, [name, category, gender, imageUrl, subtitle]);
        return serializeCandidate(inserted.rows[0]);
      });
    },
    updateCandidate(id, changes = {}) {
      return withReady(async () => {
        const currentResult = await pool.query('SELECT * FROM candidates WHERE id = $1', [Number(id)]);
        const current = currentResult.rows[0];
        if (!current) return null;
        const candidate = {
          name: changes.name === undefined ? current.name : String(changes.name || '').trim(),
          category: changes.category === undefined ? current.category : String(changes.category || '').trim(),
          gender: changes.gender === undefined ? current.gender : String(changes.gender || '').trim(),
          imageUrl: changes.imageUrl === undefined && changes.imagePath === undefined && changes.image === undefined
            ? current.image_url : String(changes.imageUrl ?? changes.imagePath ?? changes.image ?? '').trim() || null,
          subtitle: changes.subtitle === undefined ? current.subtitle : String(changes.subtitle || '').trim() || null
        };
        if (!candidate.name || !['HND', 'IGCSE/GED'].includes(candidate.category) || !['King', 'Queen'].includes(candidate.gender)) {
          throw new Error('A candidate name, category, and gender are required.');
        }
        const updated = await pool.query(`
          UPDATE candidates SET name = $1, category = $2, gender = $3, image_url = $4, subtitle = $5, updated_at = CURRENT_TIMESTAMP
          WHERE id = $6
          RETURNING id, name, category, gender, image_url AS "imageUrl", subtitle, active
        `, [candidate.name, candidate.category, candidate.gender, candidate.imageUrl, candidate.subtitle, Number(id)]);
        return serializeCandidate(updated.rows[0]);
      });
    },
    deleteCandidate(id) {
      return withReady(async () => (await pool.query('DELETE FROM candidates WHERE id = $1', [Number(id)])).rowCount > 0);
    },
    clearVotes() {
      return withReady(async () => (await pool.query('DELETE FROM votes')).rowCount);
    },
    recordVote(vote = {}, { allowRepeat = false } = {}) {
      return withReady(async () => {
        const { email, name, batch, hndKing, hndQueen, gedKing, gedQueen } = vote || {};
        const normalizedEmail = normalizeEmail(email);
        const normalizedName = String(name || '').trim();
        const normalizedBatch = String(batch || '').trim();
        const choices = [[hndKing, 'HND', 'King'], [hndQueen, 'HND', 'Queen'], [gedKing, 'IGCSE/GED', 'King'], [gedQueen, 'IGCSE/GED', 'Queen']];
        if (!normalizedEmail || !normalizedName || !normalizedBatch) return { accepted: false, reason: 'invalid_request' };
        const candidateResult = await pool.query(`
          SELECT name, category, gender FROM candidates
          WHERE active = TRUE AND (
            (name = $1 AND category = $2 AND gender = $3)
            OR (name = $4 AND category = $5 AND gender = $6)
            OR (name = $7 AND category = $8 AND gender = $9)
            OR (name = $10 AND category = $11 AND gender = $12)
          )
        `, choices.flat());
        const validChoices = new Set(candidateResult.rows.map((candidate) => `${candidate.name}|${candidate.category}|${candidate.gender}`));
        if (choices.some(([choice, category, gender]) => !validChoices.has(`${choice}|${category}|${gender}`))) return { accepted: false, reason: 'invalid_request' };
        const storedEmail = allowRepeat ? `${normalizedEmail}#test-${Date.now()}-${Math.random().toString(36).slice(2)}` : normalizedEmail;
        try {
          await pool.query(`
            INSERT INTO votes (email, name, batch, hnd_king, hnd_queen, ged_king, ged_queen)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [storedEmail, normalizedName, normalizedBatch, hndKing, hndQueen, gedKing, gedQueen]);
          return { accepted: true };
        } catch (error) {
          if (error.code === '23505') return { accepted: false, reason: 'already_voted' };
          throw error;
        }
      });
    },
    getResults() {
      return withReady(async () => {
        const votersResult = await pool.query(`SELECT name, email, batch, hnd_king AS "hndKing", hnd_queen AS "hndQueen", ged_king AS "gedKing", ged_queen AS "gedQueen" FROM votes ORDER BY id ASC`);
        const voters = votersResult.rows.map((voter) => ({ ...voter, email: voter.email.replace(/#test-[^-]+-[a-z0-9]+$/i, ''), king: voter.hndKing, queen: voter.hndQueen }));
        const count = async (column) => Object.fromEntries((await pool.query(`SELECT ${column} AS candidate, COUNT(*)::int AS votes FROM votes WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY ${column}`)).rows.map(({ candidate, votes }) => [candidate, votes]));
        const [hndKings, hndQueens, gedKings, gedQueens] = await Promise.all([count('hnd_king'), count('hnd_queen'), count('ged_king'), count('ged_queen')]);
        return { total: voters.length, kings: hndKings, queens: hndQueens, hndKings, hndQueens, gedKings, gedQueens, voters };
      });
    },
    close() {
      return pool.end();
    }
  };
}

async function initialize(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('HND', 'IGCSE/GED')),
      gender TEXT NOT NULL CHECK (gender IN ('King', 'Queen')),
      image_url TEXT,
      subtitle TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (name, category, gender)
    );
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      batch TEXT,
      hnd_king TEXT,
      hnd_queen TEXT,
      ged_king TEXT,
      ged_queen TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Ensure a default voting state exists (closed by default)
  await pool.query(`
    INSERT INTO settings (key, value)
    VALUES ('voting', 'false')
    ON CONFLICT (key) DO NOTHING
  `);
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM candidates');
  if (count.rows[0].count === 0) {
    for (const candidate of SEEDED_CANDIDATES) {
      await pool.query(`INSERT INTO candidates (name, category, gender, image_url, subtitle) VALUES ($1, $2, $3, $4, $5)`, [candidate.name, candidate.category, candidate.gender, candidate.imageUrl || null, candidate.subtitle || null]);
    }
  }
}
