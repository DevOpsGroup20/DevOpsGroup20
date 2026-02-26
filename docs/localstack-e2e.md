# LocalStack E2E (Minimal)

This project has an end-to-end test for the booking workflow using LocalStack.

## What it validates
- Happy path (`COMPLETED`)
- Seat reservation failure (`simulateBookingFailure=seats` -> `FAILED`)
- Payment failure (`simulateBookingFailure=payment` -> `FAILED`)
- Ticket generation failure (`simulateBookingFailure=ticket` -> `FAILED`)

Test file: `tests/e2e/booking-workflow.mjs`

## Run locally
1. Start LocalStack:
   - `docker compose up -d localstack`
2. Build and deploy:
   - `samlocal build --template template.yaml`
   - `samlocal deploy --stack-name devopsgroup20-e2e-local --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset --no-fail-on-empty-changeset`
3. Resolve API id and run tests:
   - `API_ID=$(awslocal cloudformation describe-stack-resources --stack-name devopsgroup20-e2e-local --logical-resource-id API --query "StackResources[0].PhysicalResourceId" --output text)`
   - `BOOKING_API_BASE_URL="http://localhost:4566/restapis/${API_ID}/Prod/_user_request_" npm run test:e2e:booking`
   - To enable verbose request/response logging, add `BOOKING_VERBOSE=1` (accepts `1` or `true`):
     ```sh
     BOOKING_API_BASE_URL="http://localhost:4566/restapis/${API_ID}/Prod/_user_request_" \
       BOOKING_VERBOSE=1 \
       npm run test:e2e:booking
     ```
4. Inspect DynamoDB contents after the tests:
   - Resolve the table name:
     ```sh
     TABLE_NAME=$(awslocal cloudformation describe-stack-resources \
       --stack-name devopsgroup20-e2e-local \
       --logical-resource-id Bookings \
       --query "StackResources[0].PhysicalResourceId" \
       --output text)
     ```
   - Scan all items (pretty-printed):
     ```sh
     awslocal dynamodb scan --table-name "$TABLE_NAME" --output json | python3 -m json.tool
     ```
   - Look up a specific booking by ID:
     ```sh
     awslocal dynamodb get-item \
       --table-name "$TABLE_NAME" \
       --key '{"bookingReferenceId": {"S": "<your-booking-id>"}}'
     ```
5. Cleanup:
   - `awslocal cloudformation delete-stack --stack-name devopsgroup20-e2e-local`
   - `awslocal cloudformation wait stack-delete-complete --stack-name devopsgroup20-e2e-local`
   - `docker compose down -v`

## CI workflow
- File: `.github/workflows/booking-workflow-e2e-localstack.yml`
- Trigger: pull requests and manual dispatch
