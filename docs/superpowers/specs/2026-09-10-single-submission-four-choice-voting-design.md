# Single-Submission Four-Choice Voting Design

## Goal

Allow each email address to complete exactly one voting submission. A completed submission must contain:

- one HND king;
- one HND queen;
- one IGCSE/GED king; and
- one IGCSE/GED queen.

After a successful submission, the email address cannot vote again. Invalid or incomplete requests must not consume the vote.

## Backend behavior

The API will accept the four candidate selections in one `POST /api/votes` request. The server will validate that:

1. all voter details are present;
2. all four candidate values are recognized;
3. each selected candidate belongs to the required category;
4. the email has not already submitted a vote.

The existing candidate allowlists will be split into HND and IGCSE/GED groups so category validation is explicit rather than inferred from arbitrary strings.

## Data storage and migration

The current `votes` table has a legacy `couple_id` check constraint that only permits numeric IDs. The server will migrate legacy databases by rebuilding the table without that constraint, preserving existing rows and their available voter/candidate data.

One database row will represent one completed submission. The email remains unique, which permanently prevents a second submission. The row will store the four selected candidates and the existing voter details. The obsolete `couple_id` value will no longer be used for new writes.

## Results and compatibility

The admin results API will continue returning total votes, candidate totals, and voter details. It will include the four stored selections in a compatible voter record shape, with the existing king and queen fields retained and the additional category selections represented by separate fields where needed.

## Error handling

- Missing, invalid, or category-mismatched selections return HTTP 400 with an invalid-request error.
- A previously used email returns HTTP 409 with an already-voted error.
- Database errors other than the expected unique-email conflict are surfaced as failures.

## Testing

Regression tests will cover:

1. a valid submission containing all four choices;
2. rejection of a second submission from the same email;
3. rejection of missing or category-mismatched choices;
4. preservation and usability of data from the legacy constrained schema;
5. accurate admin totals for the four-choice submission.
