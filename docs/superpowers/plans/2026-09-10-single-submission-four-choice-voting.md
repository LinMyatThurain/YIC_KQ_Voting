# Single-Submission Four-Choice Voting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each email submit exactly one vote containing one HND king, one HND queen, one IGCSE/GED king, and one IGCSE/GED queen.

**Architecture:** Keep the existing Node HTTP server and SQLite store. Replace the single king/queen request shape with four explicit candidate fields, enforce category membership in `recordVote`, and migrate legacy SQLite tables by rebuilding the `votes` table without the obsolete numeric `couple_id` check constraint. Keep email unique so a successful submission permanently blocks later submissions.

**Tech Stack:** Node.js ES modules, `better-sqlite3`, `node:test`, SQLite.

---

## Chunk 1: Vote-store contract and migration

### Task 1: Add failing tests for the new single-submission contract

**Files:**
- Modify: `server.test.js`

- [ ] **Step 1: Add a test for all four selections**

Update the test input to use `hndKing`, `hndQueen`, `gedKing`, and `gedQueen`. Assert that one valid submission is accepted and the admin result exposes all four choices.

- [ ] **Step 2: Add a test that the email is permanently blocked**

Submit a valid four-choice vote, then submit another valid four-choice vote with the same email and assert `{ accepted: false, reason: 'already_voted' }`.

- [ ] **Step 3: Add a test for missing or category-mismatched choices**

Assert that missing one of the four choices, using an HND candidate in a GED field, or using a GED candidate in an HND field returns `{ accepted: false, reason: 'invalid_request' }`.

- [ ] **Step 4: Add a legacy-schema migration test**

Create a temporary SQLite database with the existing `couple_id TEXT NOT NULL CHECK (couple_id IN ('01', ...))` schema, insert an old row, open it through `createVoteStore`, record a valid four-choice vote, and assert both rows remain readable.

- [ ] **Step 5: Run the focused tests and verify they fail for the expected contract mismatch**

Run:

```text
cmd /c npm test
```

Expected: the existing duplicate-email and result-shape tests may fail after their request shape is updated, and the new four-choice/migration tests fail because production code still accepts only `king` and `queen`.

### Task 2: Implement category-aware candidate validation

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Split candidate allowlists into HND and IGCSE/GED sets**

Define `VALID_HND_KINGS`, `VALID_HND_QUEENS`, `VALID_GED_KINGS`, and `VALID_GED_QUEENS`. Keep the current candidate names unchanged.

- [ ] **Step 2: Update the votes table definition**

Create the current table with unique email, voter details, and four candidate columns:

```sql
hnd_king TEXT NOT NULL,
hnd_queen TEXT NOT NULL,
ged_king TEXT NOT NULL,
ged_queen TEXT NOT NULL
```

Do not use `couple_id` for new writes.

- [ ] **Step 3: Add the legacy table migration**

Inspect `PRAGMA table_info(votes)` and the table SQL. If the table has the legacy `couple_id` constraint or lacks any required four-choice columns, rebuild it inside a transaction:

1. create `votes_new` with the current schema;
2. copy existing rows, mapping available legacy `king`/`queen` values into HND fields and using the stored legacy values where possible;
3. retain legacy rows without inventing invalid candidate selections;
4. drop the old table and rename `votes_new` to `votes`.

Migration must preserve email, voter details, timestamps, and existing candidate data. Existing legacy rows should remain visible to the admin view even if their original schema did not contain four complete choices.

- [ ] **Step 4: Update `recordVote`**

Accept the four candidate fields, normalize voter inputs, require all four values, validate each against its matching category set, insert one row, and preserve the existing unique-email conflict behavior.

- [ ] **Step 5: Update `getResults`**

Return the four candidate fields for each voter. Count HND and GED king/queen selections independently so the admin page can display totals for all selected candidates.

- [ ] **Step 6: Run the focused tests**

Run:

```text
cmd /c npm test
```

Expected: all store tests pass.

## Chunk 2: HTTP API and frontend request shape

### Task 3: Update API validation and error behavior

**Files:**
- Modify: `server.js`
- Modify: `server.test.js`

- [ ] **Step 1: Add HTTP-level regression tests**

Exercise `POST /api/votes` with all four fields and assert HTTP 201. Repeat with the same email and assert HTTP 409. Submit incomplete/category-mismatched JSON and assert HTTP 400.

- [ ] **Step 2: Update the API error message**

Keep invalid requests as HTTP 400 and already-used emails as HTTP 409, but make the invalid error explain that one HND pair and one IGCSE/GED pair are required.

- [ ] **Step 3: Run the HTTP tests**

Run:

```text
cmd /c npm test
```

Expected: all API and store tests pass.

### Task 4: Update the voting page to submit four choices

**Files:**
- Modify: `voting_page.html`

- [ ] **Step 1: Add separate HND and IGCSE/GED candidate controls**

Provide one required king and one required queen selector for each category. Preserve the current page styling and candidate image/content patterns.

- [ ] **Step 2: Submit the four fields in one request**

Update the fetch payload to send `hndKing`, `hndQueen`, `gedKing`, and `gedQueen` together with voter details.

- [ ] **Step 3: Disable repeat voting after success**

After HTTP 201, disable the voting controls and show a completion message. Do not disable controls for invalid or failed submissions.

## Chunk 3: Admin results compatibility

### Task 5: Display all four candidate totals and voter selections

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add HND and IGCSE/GED result sections**

Render four independent totals: HND kings, HND queens, IGCSE/GED kings, and IGCSE/GED queens.

- [ ] **Step 2: Extend the voter table**

Show the four selected candidates while preserving name, email, and batch.

- [ ] **Step 3: Verify auto-refresh**

Keep the existing five-second refresh behavior and ensure the expanded response shape renders without errors when there are zero votes or legacy rows.

## Chunk 4: Verification

### Task 6: Run the complete validation set

**Files:**
- No additional files

- [ ] **Step 1: Run backend tests**

```text
cmd /c npm test
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Test the real database migration**

Start the server against the existing `votes.db`, submit one complete four-choice vote, query the admin endpoint, and confirm the old rows plus the new row are returned.

- [ ] **Step 3: Confirm duplicate behavior**

Submit the same email a second time and confirm the response is HTTP 409; confirm no second row was added.
