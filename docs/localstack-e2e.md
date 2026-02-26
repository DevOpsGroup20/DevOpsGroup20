# LocalStack E2E

This project includes an end-to-end LocalStack test for the booking workflow.

## What it validates
- Happy path (`COMPLETED`)
- Seat reservation failure (`simulateBookingFailure=seats` -> `FAILED`)
- Payment failure (`simulateBookingFailure=payment` -> `FAILED` with seat release)
- Ticket generation failure (`simulateBookingFailure=ticket` -> `FAILED` with seat release)
- Final seat capacity consistency (`availableSeats = 99` after all 4 scenarios)

Test file: `tests/e2e/booking-workflow.mjs`

## Run locally (single command, verbose by default)
```sh
./scripts/run-booking-e2e-localstack.sh
```

The script performs the full flow:
1. Starts LocalStack and waits until ready.
2. Builds and deploys the stack with `samlocal`.
3. Resolves API and `SeatCapacity` table names from CloudFormation.
4. Seeds seat capacity row:
   - `id=CAPACITY`
   - `totalSeats=100`
   - `availableSeats=100`
5. Runs `npm run test:e2e:booking` with `BOOKING_VERBOSE=1`.
6. Cleans up stack and LocalStack (unless `CLEANUP=0`).

## Useful overrides
- Keep resources after test: `CLEANUP=0 ./scripts/run-booking-e2e-localstack.sh`
- Disable shell command trace: `TRACE=0 ./scripts/run-booking-e2e-localstack.sh`
- Change stack name: `STACK_NAME=my-local-e2e ./scripts/run-booking-e2e-localstack.sh`
- Tune polling:
  - `BOOKING_POLL_INTERVAL_MS=500`
  - `BOOKING_POLL_TIMEOUT_MS=90000`

## Manual test execution (optional)
If you want to run the test runner directly, pass both required environment variables:
```sh
BOOKING_API_BASE_URL="<api-base-url>" \
SEAT_CAPACITY_TABLE_NAME="<seat-capacity-table-name>" \
BOOKING_VERBOSE=1 \
npm run test:e2e:booking
```

## CI workflow
- File: `.github/workflows/booking-workflow-e2e-localstack.yml`
- Trigger: pull requests and manual dispatch
