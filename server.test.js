import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, createVoteStore } from './server.js';

const adminHeaders = {
  Authorization: `Basic ${Buffer.from('admin:uzawlin').toString('base64')}`
};

const validVote = (email = 'voter@example.com') => ({
  email,
  name: 'Alex Johnson',
  batch: 'Batch 2026',
  hndKing: 'Aiden Cole',
  hndQueen: 'Kyi Nue Wai',
  gedKing: 'IGCSE/GED King 01',
  gedQueen: 'IGCSE/GED Queen 01'
});

test('serves the voting website from the Node server', async () => {
  const store = createVoteStore(':memory:');
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://localhost:${port}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="voter-form"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('seeds the editable candidate catalog from the current candidates', () => {
  const store = createVoteStore(':memory:');
  const candidates = store.getCandidates();

  assert.equal(candidates.length, 22);
  assert.deepEqual(candidates.filter((candidate) => candidate.category === 'HND' && candidate.gender === 'King')
    .map((candidate) => candidate.name), [
    'Aiden Cole', 'Noah James', 'Liam Brooks', 'Ethan King', 'Leo Grant'
  ]);
  assert.equal(candidates.find((candidate) => candidate.name === 'Kyi Nue Wai').imageUrl.includes('Kyi'), true);
  store.close();
});

test('validates votes against active catalog entries', () => {
  const store = createVoteStore(':memory:');
  const added = store.createCandidate({
    name: 'New HND King',
    category: 'HND',
    gender: 'King',
    subtitle: 'HND candidate'
  });

  assert.equal(added.name, 'New HND King');
  assert.deepEqual(store.recordVote({
    ...validVote('catalog@example.com'),
    hndKing: 'New HND King'
  }), { accepted: true });

  store.deleteCandidate(added.id);
  assert.deepEqual(store.recordVote({
    ...validVote('deleted-catalog@example.com'),
    hndKing: 'New HND King'
  }), { accepted: false, reason: 'invalid_request' });
  store.close();
});

test('rejects a second vote from the same email address', () => {
  const store = createVoteStore(':memory:');

  const firstVote = store.recordVote(validVote(' Voter@Example.com '));
  const secondVote = store.recordVote({
    ...validVote('voter@example.com'),
    name: 'Another Voter',
    hndKing: 'Noah James',
    hndQueen: 'Yoon Ya Mone Naing',
    gedKing: 'IGCSE/GED King 02',
    gedQueen: 'IGCSE/GED Queen 02'
  });

  assert.deepEqual(firstVote, { accepted: true });
  assert.deepEqual(secondVote, {
    accepted: false,
    reason: 'already_voted'
  });

  store.close();
});

test('returns voter details and vote totals for the admin view', () => {
  const store = createVoteStore(':memory:');

  store.recordVote({
    email: 'first@example.com',
    name: 'First Voter',
    batch: 'Batch 40',
    hndKing: 'Aiden Cole',
    hndQueen: 'Kyi Nue Wai',
    gedKing: 'IGCSE/GED King 01',
    gedQueen: 'IGCSE/GED Queen 01'
  });
  store.recordVote({
    email: 'second@example.com',
    name: 'Second Voter',
    batch: 'Batch 39',
    hndKing: 'Aiden Cole',
    hndQueen: 'Thiri Khit',
    gedKing: 'IGCSE/GED King 01',
    gedQueen: 'IGCSE/GED Queen 01'
  });

  assert.deepEqual(store.getResults(), {
    total: 2,
    kings: { 'Aiden Cole': 2 },
    queens: { 'Kyi Nue Wai': 1, 'Thiri Khit': 1 },
    hndKings: { 'Aiden Cole': 2 },
    hndQueens: { 'Kyi Nue Wai': 1, 'Thiri Khit': 1 },
    gedKings: { 'IGCSE/GED King 01': 2 },
    gedQueens: { 'IGCSE/GED Queen 01': 2 },
    voters: [
      {
        name: 'First Voter',
        email: 'first@example.com',
        batch: 'Batch 40',
        hndKing: 'Aiden Cole',
        hndQueen: 'Kyi Nue Wai',
        gedKing: 'IGCSE/GED King 01',
        gedQueen: 'IGCSE/GED Queen 01',
        king: 'Aiden Cole',
        queen: 'Kyi Nue Wai'
      },
      {
        name: 'Second Voter',
        email: 'second@example.com',
        batch: 'Batch 39',
        hndKing: 'Aiden Cole',
        hndQueen: 'Thiri Khit',
        gedKing: 'IGCSE/GED King 01',
        gedQueen: 'IGCSE/GED Queen 01',
        king: 'Aiden Cole',
        queen: 'Thiri Khit'
      }
    ]
  });

  store.close();
});

test('migrates the legacy couple id constraint before recording named candidates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yic-voting-'));
  const databasePath = join(directory, 'votes.db');
  const legacyDatabase = new Database(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      couple_id TEXT NOT NULL CHECK (couple_id IN ('01', '02', '03', '04', '05')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      king TEXT,
      queen TEXT,
      name TEXT,
      batch TEXT
    )
  `);
  legacyDatabase.prepare(
    'INSERT INTO votes (email, couple_id, name, batch, king, queen) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('existing@example.com', '01', 'Existing Voter', 'Batch 2025', 'Aiden Cole', 'Kyi Nue Wai');
  legacyDatabase.close();

  const store = createVoteStore(databasePath);
  assert.deepEqual(store.recordVote({
    ...validVote('new@example.com'),
    name: 'New Voter',
    hndKing: 'Noah James',
    hndQueen: 'Thiri Khit',
    gedKing: 'IGCSE/GED King 02',
    gedQueen: 'IGCSE/GED Queen 02'
  }), { accepted: true });
  assert.equal(store.getResults().total, 2);
  assert.deepEqual(store.getResults().voters[0], {
    name: 'Existing Voter',
    email: 'existing@example.com',
    batch: 'Batch 2025',
    hndKing: 'Aiden Cole',
    hndQueen: 'Kyi Nue Wai',
    gedKing: null,
    gedQueen: null,
    king: 'Aiden Cole',
    queen: 'Kyi Nue Wai'
  });

  store.close();
  rmSync(directory, { recursive: true, force: true });
});

test('rejects missing or category-mismatched choices', () => {
  const store = createVoteStore(':memory:');

  for (const invalidVote of [
    { ...validVote('missing@example.com'), gedQueen: undefined },
    { ...validVote('king-category@example.com'), hndKing: 'IGCSE/GED King 01' },
    { ...validVote('queen-category@example.com'), gedQueen: 'Kyi Nue Wai' }
  ]) {
    assert.deepEqual(store.recordVote(invalidVote), {
      accepted: false,
      reason: 'invalid_request'
    });
  }

  store.close();
});

test('accepts a complete vote through the HTTP API and blocks repeat submissions', async () => {
  const store = createVoteStore(':memory:');
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const startResponse = await fetch(`http://localhost:${port}/api/admin/voting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(await (await fetch(`http://localhost:${port}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@yic' })
        })).json()).token}`
      },
      body: JSON.stringify({ action: 'start' })
    });
    assert.equal(startResponse.status, 200);

    const firstResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validVote('api@example.com'))
    });
    assert.equal(firstResponse.status, 201);

    const adminResponse = await fetch(`http://localhost:${port}/api/admin/results`, {
      headers: { Authorization: `Basic ${Buffer.from('admin:uzawlin').toString('base64')}` }
    });
    assert.equal(adminResponse.status, 200);
    const adminResults = await adminResponse.json();
    assert.equal(adminResults.total, 1);
    assert.deepEqual(adminResults.voters[0], {
      name: 'Alex Johnson',
      email: 'api@example.com',
      batch: 'Batch 2026',
      hndKing: 'Aiden Cole',
      hndQueen: 'Kyi Nue Wai',
      gedKing: 'IGCSE/GED King 01',
      gedQueen: 'IGCSE/GED Queen 01',
      king: 'Aiden Cole',
      queen: 'Kyi Nue Wai'
    });

    const secondResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validVote('api@example.com'))
    });
    assert.equal(secondResponse.status, 409);

    const invalidResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validVote('invalid-api@example.com'), gedKing: 'Aiden Cole' })
    });
    assert.equal(invalidResponse.status, 400);

    const preflightResponse = await fetch(`http://localhost:${port}/api/admin/results`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5500',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    });

    assert.equal(preflightResponse.status, 204);
    assert.equal(preflightResponse.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, DELETE, OPTIONS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('allows the test admin to submit repeated votes without changing normal voting rules', async () => {
  const store = createVoteStore(':memory:');
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const testAdminAuthorization = `Basic ${Buffer.from('test-admin:testadmin').toString('base64')}`;

  try {
    const adminLogin = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@yic' })
    });
    const adminToken = (await adminLogin.json()).token;
    const startResponse = await fetch(`http://localhost:${port}/api/admin/voting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ action: 'start' })
    });
    assert.equal(startResponse.status, 200);

    const payload = validVote('test-voter@example.com');
    const firstResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: testAdminAuthorization
      },
      body: JSON.stringify(payload)
    });
    const secondResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: testAdminAuthorization
      },
      body: JSON.stringify(payload)
    });

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.equal(store.getResults().total, 2);

    const normalPayload = validVote('normal-voter@example.com');
    const normalFirstResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalPayload)
    });
    const normalResponse = await fetch(`http://localhost:${port}/api/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalPayload)
    });
    assert.equal(normalFirstResponse.status, 201);
    assert.equal(normalResponse.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('protects candidate catalog reads and admin CRUD with authentication', async () => {
  const store = createVoteStore(':memory:');
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const unauthorized = await fetch(`http://localhost:${port}/api/candidates`);
    assert.equal(unauthorized.status, 401);

    const unauthorizedCreate = await fetch(`http://localhost:${port}/api/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized', category: 'HND', gender: 'King' })
    });
    assert.equal(unauthorizedCreate.status, 401);

    const candidatesResponse = await fetch(`http://localhost:${port}/api/candidates`, {
      headers: adminHeaders
    });
    assert.equal(candidatesResponse.status, 200);
    assert.equal((await candidatesResponse.json()).length, 22);

    const createResponse = await fetch(`http://localhost:${port}/api/candidates`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'API Candidate',
        category: 'IGCSE/GED',
        gender: 'Queen',
        subtitle: 'New subtitle'
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.name, 'API Candidate');

    const patchResponse = await fetch(`http://localhost:${port}/api/candidates/${created.id}`, {
      method: 'PATCH',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtitle: 'Updated subtitle',
        imageUrl: `data:image/png;base64,${'a'.repeat(20_000)}`
      })
    });
    assert.equal(patchResponse.status, 200);
    const updated = await patchResponse.json();
    assert.equal(updated.subtitle, 'Updated subtitle');
    assert.equal(updated.imageUrl.length > 20_000, true);

    const deleteResponse = await fetch(`http://localhost:${port}/api/candidates/${created.id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert.equal(deleteResponse.status, 204);

    const allCandidatesResponse = await fetch(`http://localhost:${port}/api/admin/candidates`, {
      headers: adminHeaders
    });
    assert.equal(allCandidatesResponse.status, 200);
    const allCandidates = await allCandidatesResponse.json();
    assert.equal(allCandidates.some((candidate) => candidate.id === created.id), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('clears votes only through authenticated admin endpoint and preserves candidates', async () => {
  const store = createVoteStore(':memory:');
  store.recordVote(validVote('clear-me@example.com'));
  const candidateCount = store.getCandidates().length;
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const unauthorized = await fetch(`http://localhost:${port}/api/admin/votes`, {
      method: 'DELETE'
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(store.getResults().total, 1);

    const clearResponse = await fetch(`http://localhost:${port}/api/admin/votes`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert.equal(clearResponse.status, 200);
    assert.deepEqual(await clearResponse.json(), { deleted: 1 });
    assert.equal(store.getResults().total, 0);
    assert.equal(store.getCandidates().length, candidateCount);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
