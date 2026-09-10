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
- `state_version`: a non-negative integer

Starting voting sets `voting` to `true`, records the current UTC server time in `started_at`, and increments `state_version` by 1. Repeating Start while already open is idempotent and preserves the original `started_at` and `state_version`. Stopping voting sets `voting` to `false`, clears `started_at`, and increments `state_version` by 1. Repeating Stop is idempotent. SQLite and PostgreSQL stores expose the same interface, and each state update is one atomic database operation.

Existing databases must be upgraded idempotently when the application starts. SQLite uses schema inspection followed by `ALTER TABLE ... ADD COLUMN` for missing `started_at` and `state_version` columns. PostgreSQL uses `ADD COLUMN IF NOT EXISTS`. The migration runs before state reads, does not modify votes or candidates, and initializes missing values as closed with `started_at = NULL` and `state_version = 0`. If migration fails, startup/initialization fails visibly rather than serving a partially initialized store.

### API

`GET /api/voting` returns:

```json
{
  "voting": true,
  "startedAt": "2026-09-10T16:00:00.000Z",
  "stateVersion": 3
}
```

When voting is closed, `startedAt` is `null`. `stateVersion` starts at 0 for a new database and increments only when the persisted open/closed state changes.

The authenticated admin `POST /api/admin/voting` endpoint continues to accept `{"action":"start"}` and `{"action":"stop"}`. The response includes the same state shape so the admin UI can update immediately. Valid actions return HTTP 200. Invalid JSON or actions return HTTP 400 with `{"error":"..."}`. Unauthenticated requests return HTTP 401 with `{"error":"Admin authentication required."}`. Storage failures return HTTP 500 with `{"error":"..."}` and do not claim success. `startedAt` is an ISO-8601 UTC string or `null`; `stateVersion` is an integer.

The server remains authoritative: `POST /api/votes` rejects normal submissions while voting is closed regardless of client state.

### Voting-page behavior

The page tracks whether it has completed its initial state read and stores the last accepted state version. The server-issued timestamp is the only timing source; local time is used only to compare elapsed duration. Each poll gets a monotonically increasing request ID before its fetch starts. A response is ignored when its request ID is lower than the latest response already applied. Among responses with the same request ID, the first response is applied and later duplicates are ignored. A reload resets the request ID and treats the first successful response as the initial state.

The client accepts a response only when its `stateVersion` is greater than or equal to the displayed version and its request ID is not older than the latest applied request ID. A response with a lower state version is ignored. If two responses have the same version, the higher request ID wins. The server/database commit order determines the final state; a later committed version always has a greater state version.

- On initial load, if voting is already open, the page displays enabled voting controls without a countdown.
- If a later poll observes a closed-to-open transition, the page calculates `remaining = max(0, 10 seconds - (current time - startedAt))`. The countdown displays the ceiling of remaining seconds, so all pages already open at the transition show the same remaining time within normal clock skew.
- If the calculated countdown has already elapsed, the page skips the overlay and enables voting immediately.
- A stop transition immediately disables candidate inputs and submission and cancels any active countdown overlay.
- Polling continues at the current interval; no additional connection technology is introduced.

### State transition table

| Current server state | Event | Persisted result | Existing page behavior | Late-joining page behavior |
| --- | --- | --- | --- | --- |
| Closed | Start | Open, new `startedAt`, increment version | Start synchronized countdown | Show open form immediately |
| Open | Start | Open, preserve `startedAt`, unchanged version | No new countdown | Show open form immediately |
| Open | Stop | Closed, clear `startedAt`, increment version | Cancel countdown and disable form | Show closed message |
| Closed | Stop | Closed, unchanged version | Remain disabled | Show closed message |

The server serializes each state update through the database row/key. Concurrent requests resolve in commit order; the response from each request reports the state committed by that request. The last committed state is authoritative. A submission already accepted by the server is not rolled back if Stop happens immediately afterward; a submission that reaches the server after Stop is rejected.

### Error handling

If the voting-state request fails, the page keeps voting controls disabled until a successful response confirms the state and displays a clear status message. Malformed responses or a missing `voting` boolean are treated as failures. A stale open state must not bypass server-side submission checks. There is no client-side retry backoff change in this scope; the existing polling interval retries on the next poll.

## Verification

Automated tests will cover:

1. SQLite initializes with a closed state and a null start timestamp.
2. Starting and stopping updates both fields correctly.
3. The voting-state API returns `voting` and `startedAt`.
4. Normal submissions remain blocked while closed and work while open.
5. PostgreSQL initialization and state operations use the same interface.
6. Repeated Start preserves the original timestamp, repeated Stop remains closed, and rapid state changes leave the final persisted state authoritative.
7. Schema migration is idempotent when initialization runs more than once.
8. A countdown at exactly 10 seconds shows 10, at 0 seconds skips the overlay, and a stale response cannot reopen or re-close the UI over a newer response.
9. State-version fixtures assert `0 -> 1 -> 2` for Start -> Stop, and repeated Start/Stop do not increment.

Manual QA will verify:

1. An already-open voting page does not animate for a late joiner.
2. A page left open before Start shows the synchronized countdown.
3. Stop immediately prevents new submissions.
4. A Stop during the 10-second countdown cancels the overlay and disables the form.
5. A late-joining page skips the countdown even when the database is already open.
6. Two quick admin actions leave every page matching the final state after the next successful poll.
