# Real-Time Voting Countdown Synchronization

## Goal

Make the 10-to-1 voting countdown represent the actual start event. Pages that are already open when an administrator starts voting should animate. Pages opened after voting has already started should show the voting form immediately without replaying the countdown.

## Scope

This change updates the existing voting-state persistence, API response, voting-page polling, and automated tests. It does not add WebSockets, Server-Sent Events, authentication changes, or new hosting infrastructure.

## Design

### Persisted voting state

The existing `settings` table will store:

- `voting`: `true` or `false`
- `started_at`: a nullable timestamp

Starting voting sets `voting` to `true` and records the current server time in `started_at`. Stopping voting sets `voting` to `false` and clears `started_at`. SQLite and PostgreSQL stores expose the same interface.

Existing databases must be upgraded safely when the application starts. A missing `started_at` column is added without changing existing votes or candidates. A closed state remains the default.

### API

`GET /api/voting` returns:

```json
{
  "voting": true,
  "startedAt": "2026-09-10T16:00:00.000Z"
}
```

When voting is closed, `startedAt` is `null`.

The authenticated admin `POST /api/admin/voting` endpoint continues to accept `{"action":"start"}` and `{"action":"stop"}`. The response includes the same state shape so the admin UI can update immediately.

The server remains authoritative: `POST /api/votes` rejects normal submissions while voting is closed regardless of client state.

### Voting-page behavior

The page records its load time and tracks the last observed server state.

- On initial load, if voting is already open, the page displays enabled voting controls without a countdown.
- If a later poll observes a closed-to-open transition, the page calculates the countdown from `startedAt`, so all pages already open at the transition show the same remaining time.
- If the calculated countdown has already elapsed, the page skips the overlay and enables voting immediately.
- A stop transition immediately disables candidate inputs and submission.
- Polling continues at the current interval; no additional connection technology is introduced.

### Error handling

If the voting-state request fails, the page keeps voting controls disabled and displays a clear status message. A stale open state must not bypass server-side submission checks.

## Verification

Automated tests will cover:

1. SQLite initializes with a closed state and a null start timestamp.
2. Starting and stopping updates both fields correctly.
3. The voting-state API returns `voting` and `startedAt`.
4. Normal submissions remain blocked while closed and work while open.
5. PostgreSQL initialization and state operations use the same interface.

Manual QA will verify:

1. An already-open voting page does not animate for a late joiner.
2. A page left open before Start shows the synchronized countdown.
3. Stop immediately prevents new submissions.
