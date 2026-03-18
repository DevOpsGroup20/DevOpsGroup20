# AWS Cloud Architecture — Ticket Booking Service

## Overview

This document describes the target AWS architecture for migrating the ticket booking service from a local Camunda/Zeebe + RabbitMQ setup to a fully serverless, cloud-native deployment on AWS. The core business logic and the separation of the three fake services are preserved.

**Key replacements:**

| Original | AWS Replacement |
|---|---|
| Camunda Zeebe (BPMN workflow) | AWS Step Functions (Standard Workflow) |
| RabbitMQ (AMQP queues) | Amazon SQS FIFO |
| Spring Boot REST layer | API Gateway + Lambda |
| Zeebe workflow state | Amazon DynamoDB |
| Fake services (gRPC/AMQP/REST) | Three isolated Lambda functions |

## Service Inventory

### API & Compute

| Service | Name / Instance | Purpose |
|---|---|---|
| **API Gateway** | `booking-api` (REST API, stage: Prod) | Public HTTPS entry point; routes PUT /ticket (direct Step Functions SDK integration) and GET /booking/{id} (Lambda proxy); CORS enabled |
| **API Gateway Integration** | `APIToBookingWorkflowRole` | PUT /ticket is handled via a direct API Gateway → Step Functions SDK integration (`states:StartExecution`); no Lambda intermediary; returns `bookingReferenceID` (`$context.requestId`) in the response body |
| **Lambda** | `GetBooking` | Handles GET /booking/{id}: reads DynamoDB Bookings table, returns booking row; timeout 30 s |
| **Lambda** | `SeatReservation` | Invoked directly by Step Functions; returns reservationId or throws error; timeout 30 s |
| **Lambda** | `Payment` | Triggered by SQS FIFO (batchSize=1); processes payment, updates DynamoDB with paymentConfirmationId, calls SendTaskSuccess/Failure; timeout 30 s |
| **Lambda** | `TicketGeneration` | Invoked directly by Step Functions; returns ticketId; timeout 30 s |

> No Lambda intermediary is needed to send messages to SQS or to update DynamoDB.
> Both are handled via Step Functions' native SDK integrations (see Design Decisions).

#### Lambda Concurrency Configuration

To prevent pool exhaustion and noisy-neighbour throttling, each function carries an explicit reserved concurrency allocation from the account default of 1,000 concurrent executions.

| Lambda | Reserved Concurrency | Rationale |
|---|---|---|
| `GetBooking` | 100 | User-facing read path |
| `SeatReservation` | 50 | Step Functions–invoked; cold start is absorbed by workflow latency |
| `Payment` | 50 | SQS-driven; concurrency bounded by queue batch size |
| `TicketGeneration` | 50 | Step Functions–invoked; tolerates cold start |
| **Unreserved pool** | **550** | Headroom for burst and any other account functions |

> All values are CDK context parameters (`lambdaConcurrency.*`) and can be tuned without code changes.

### Workflow Orchestration

| Service | Name / Instance | Purpose |
|---|---|---|
| **Step Functions** | `BookingWorkflow` (Standard) | Orchestrates the full booking saga: seat reservation → payment → ticket generation → status update |

### Storage

| Service | Name / Instance | Purpose |
|---|---|---|
| **DynamoDB** | `Bookings` | Stores booking records with fields: `bookingReferenceId` (PK), `bookingStatus` (PENDING/COMPLETED/FAILED), `reservationId`, `paymentConfirmationId`, `ticketId`, `createdAt`, `updatedAt`; on-demand (PAY_PER_REQUEST) capacity mode; DynamoDB Streams enabled (NEW_AND_OLD_IMAGES) |

### Messaging

| Service | Name / Instance | Purpose |
|---|---|---|
| **SQS** | `payment-request.fifo` | FIFO queue; receives payment requests from Step Functions (with embedded task token); visibility timeout 60 s (2 × Lambda timeout); content-based deduplication enabled; message retention 1 day |
| **SQS** | `payment-request-dlq` | Dead-letter queue; `maxReceiveCount = 3`; message retention 14 days |

### Networking

| Service            | Name / Instance                                    | Notes                                                                                                                       |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **VPC**            | `booking-vpc` (10.0.0.0/16)                        | Network isolation boundary for all compute                                                                                  |
| **Private Subnet** | `private-subnet-a` (10.0.2.0/24)                   | AZ us-east-1a — Lambda ENIs; hosts Interface Endpoint ENIs                                                                  |
| **Private Subnet** | `private-subnet-b` (10.0.3.0/24)                   | AZ us-east-1b — Lambda ENIs                                                                                                 |
| **Security Group** | `lambda-sg`                                        | Allows outbound to VPC endpoints only; no inbound                                                                           |
| **Security Group** | `vpce-sg`                                          | Allows inbound 443 from `lambda-sg` only                                                                                    |
| **VPC Endpoint**   | `ddb-gateway-endpoint` (Gateway, free)             | Private DynamoDB access from Lambda; no data transfer charges                                                               |
| **VPC Endpoint**   | `sqs-interface-endpoint` (Interface, AZ-a only)    | Private SQS access from Lambda                                                                                              |
| **VPC Endpoint**   | `sfn-interface-endpoint` (Interface, AZ-a only)    | Private Step Functions access from Lambda (initiator, payment)                                                              |
| **VPC Endpoint**   | `cwlogs-interface-endpoint` (Interface, AZ-a only) | Private CloudWatch Logs access from Lambda                                                                                  |
| **Route Table**    | `private-rt-a`, `private-rt-b`                     | DynamoDB prefix → Gateway Endpoint; no default route needed — all AWS API calls stay within the VPC via Interface Endpoints |

> **Cost note:** Gateway endpoints (DynamoDB) are free. Interface endpoints (PrivateLink) cost ~\$0.01/hr per AZ. With 3 Interface Endpoints in a single AZ ≈ **$22/month**. Expanding to 2 AZs doubles this cost and is described in the [Future Enhancements](#future-enhancements) section.

### Security & Identity

| Service | Name / Instance | Purpose |
|---|---|---|
| **IAM Role** | `APIToBookingWorkflowRole` | `states:StartExecution` on BookingWorkflow ARN; assumed by `apigateway.amazonaws.com` |
| **IAM Role** | `GetBookingRole` (SAM-generated) | `dynamodb:GetItem`, `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:BatchGetItem`, `dynamodb:DescribeTable`, `dynamodb:ConditionCheckItem` on Bookings table; CloudWatch Logs |
| **IAM Role** | `SeatReservationRole` (SAM-generated) | CloudWatch Logs; X-Ray write |
| **IAM Role** | `PaymentRole` (SAM-generated) | `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem`, `dynamodb:BatchWriteItem` on Bookings table; `states:SendTaskSuccess`, `states:SendTaskFailure` on `*`; CloudWatch Logs |
| **IAM Role** | `TicketGenerationRole` (SAM-generated) | CloudWatch Logs; X-Ray write |
| **IAM Role** | `BookingWorkflowRole` (SAM-generated) | `lambda:InvokeFunction` on SeatReservation and TicketGeneration; `sqs:SendMessage` on PaymentQueue; `dynamodb:PutItem`, `dynamodb:UpdateItem` on Bookings table; CloudWatch Logs delivery; X-Ray write |
| **AWS WAF** | `booking-waf` (Regional Web ACL) | Rate-based rule on PUT /ticket (per-IP, configurable count/window); associated directly with API Gateway stage |
| **API Gateway Usage Plan** | `booking-usage-plan` | Issues API keys (`x-api-key` header required on all routes); per-route throttling: PUT /ticket 10 RPS steady / 50 RPS burst; GET /booking 50 RPS steady / 100 RPS burst |

### Monitoring & Observability

| Service | Name / Instance | Purpose |
|---|---|---|
| **CloudWatch Dashboard** | `BookingSystem` | Unified view: Lambda errors/duration, Step Functions execution rate, SQS depth, DynamoDB throttles |
| **CloudWatch Log Group** | `/aws/lambda/GetBooking` | Lambda logs; retention 90 days |
| **CloudWatch Log Group** | `/aws/lambda/SeatReservation` | Lambda logs; retention 90 days |
| **CloudWatch Log Group** | `/aws/lambda/Payment` | Lambda logs; retention 90 days |
| **CloudWatch Log Group** | `/aws/lambda/TicketGeneration` | Lambda logs; retention 90 days |
| **CloudWatch Log Group** | `/aws/vendedlogs/states/<stack>-BookingWorkflow-Logs` | Step Functions execution logs (ALL level, includes execution data); retention 90 days |
| **CloudWatch Alarm** | `booking-error-rate` | Triggers when Lambda 5xx rate > 5% over 5 minutes |
| **CloudWatch Alarm** | `payment-dlq-depth` | Triggers when DLQ message count > 0 |
| **CloudWatch Alarm** | `sfn-execution-failures` | Triggers when Step Functions failure count > threshold |
| **CloudWatch Alarm** | `api-latency-p99` | Triggers when API Gateway P99 latency > 3s |
| **AWS X-Ray** | Service map | End-to-end distributed tracing across API Gateway → Lambda → Step Functions → fake services |
| **SNS Topic** | `booking-alerts` | Receives alarm notifications; routes to email or Slack (via Chatbot) |

### CI/CD & Infrastructure as Code

| Service | Name / Instance | Purpose |
|---|---|---|
| **AWS SAM** | `template.yaml` | Defines all infrastructure as code (AWS Serverless Application Model); built and deployed via `sam build` + `sam deploy` |
| **GitHub Actions** | `.github/workflows/deploy.yml` | Build → SAM deploy on push to `dev`; uses OIDC for AWS authentication (no long-lived credentials) |
| **GitHub Actions** | `.github/workflows/booking-workflow-e2e-localstack.yml` | E2E tests via LocalStack on pull requests; spins up LocalStack, deploys stack, runs `tests/e2e/booking-workflow.mjs` |

### Cost Management

| Service               | Name / Instance  | Purpose                                       |
| --------------------- | ---------------- | --------------------------------------------- |
| **AWS Budgets**       | `monthly-budget` | Alert when monthly spend exceeds threshold    |
| **AWS Cost Explorer** | —                | Per-service cost breakdown and trend analysis |

---

## Step Functions Workflow Detail

The state machine replaces the BPMN `ticket-booking.bpmn` process:

```
START
  │
  ▼
[Create pending booking]  ── dynamodb:putItem (bookingStatus=PENDING)
  │
  ▼
[Seat Reservation]  ── invoke Lambda: SeatReservation
  │  success: reservationId
  │  catch: States.ALL ──────────────────────────────────────────┐
  │                                                              │
  ▼                                                              │
[Add reservationId]  ── dynamodb:updateItem (SET reservationId) │
  │                                                              │
  ▼                                                              │
[Payment request]  ── sqs:sendMessage.waitForTaskToken          │
  │  (Step Functions sends to SQS directly — no Lambda needed)  │
  │  (task token embedded in SQS message body)                  │
  │  TimeoutSeconds: 30                                          │
  │  timeout/failure catch ──────────────────────────────────────┤
  │  (Payment Lambda calls SendTaskSuccess/Failure)              │
  │                                                              │
  ▼                                                              │
[Ticket Generation]  ── invoke Lambda: TicketGeneration         │
  │  catch: States.ALL ──────────────────────────────────────────┤
  │                                                              │
  ▼                                                              │
[Complete booking]  ── dynamodb:updateItem (bookingStatus=COMPLETED, ticketId)
  │  (Step Functions updates DynamoDB directly — no Lambda)      │
  │                                                              │
 END (success)          ◄──────────────────────────────────────┘
                            [Fail booking]
                            dynamodb:updateItem (bookingStatus=FAILED)
                            Retry: 3 attempts (for DynamoDB write errors)
```

---

## Design Decisions

### Direct SQS Integration (no Lambda intermediary)

Step Functions exposes an **optimized SDK integration** with SQS:

```
Resource: "arn:aws:states:::sqs:sendMessage.waitForTaskToken"
```

The state embeds `$$.Task.Token` directly in the SQS message body. The Step Functions execution pauses with zero cost (Standard Workflows charge per state transition, not idle time). When `Payment` calls `SendTaskSuccess(token, result)`, the execution resumes. Step Functions sends the SQS message via **AWS-internal routing** — it does not traverse the VPC's SQS Interface Endpoint. The Interface Endpoint exists to serve Lambda functions running inside the VPC that need to call SQS APIs directly from their code.

**Why no Lambda intermediary:**

- Eliminates a cold start and Lambda cost on every booking
- No custom code to maintain for a pure "forward the message" operation
- The task token arrives at the payment Lambda via the SQS message — it is already there

The same principle applies to the final DynamoDB status update:
`arn:aws:states:::dynamodb:updateItem` lets Step Functions write directly, with no Lambda needed.

### Standard Workflow (not Express)

Express Workflows do not support `waitForTaskToken`. The payment callback pattern requires the execution to pause for an unbounded duration (seconds to minutes). Standard Workflows also provide exactly-once execution semantics — critical for financial operations — and a built-in 90-day execution history accessible via `GetExecutionHistory` API.

### Lambda in Private VPC Subnets

Lambdas are placed in private subnets to enable:

- Security group rules restricting egress to only required VPC endpoints
- Network-level isolation as a defense-in-depth layer (IAM remains the primary security boundary)
- Future VPC resources (e.g., RDS) without architecture rework

All AWS service calls (DynamoDB, SQS, Step Functions, CloudWatch Logs) reach their targets through VPC endpoints, keeping all traffic on the AWS backbone. No NAT Gateway or Internet Gateway is required.

### Gateway vs Interface VPC Endpoints

DynamoDB uses a **Gateway Endpoint** (free, no ENI). SQS, Step Functions, and CloudWatch Logs use **Interface Endpoints** (PrivateLink, paid per AZ). To minimise cost, all three Interface Endpoints are deployed in a single AZ (`private-subnet-a`). Lambdas running in `private-subnet-b` incur negligible cross-AZ latency when routing to these endpoints. Traffic to all AWS services stays within the AWS backbone.

### Lambda Timeout and Payment Flow Timing

All Lambda functions are configured with a **30-second timeout**. The SQS visibility timeout is set to **60 seconds** (2 × Lambda timeout), which prevents a message from becoming visible again while Lambda is still processing it. The `waitForTaskToken` state uses `TimeoutSeconds: 30`. This gives the Payment Lambda sufficient time to complete and call `SendTaskSuccess` or `SendTaskFailure`, while ensuring the Step Functions execution fails fast (and the booking transitions to `FAILED`) if a downstream issue prevents the Payment Lambda from responding — rather than waiting for the full DLQ promotion cycle.

When the timeout expires, Step Functions raises a `States.TaskFailed` error that is caught by the existing failure branch and routes to `[Fail booking]`.

| Parameter | Value |
|---|---|
| Lambda timeout | 30 s |
| SQS visibility timeout | 60 s (2 × Lambda timeout) |
| Event source mapping batchSize | 1 |
| maxReceiveCount (→ DLQ) | 3 |
| Main queue message retention | 1 day |
| DLQ message retention | 14 days |

> `HeartbeatSeconds` is omitted — the payment Lambda is expected to call `SendTaskSuccess` or `SendTaskFailure` in a single synchronous operation and does not stream heartbeats.

### GET /booking — Response Caching

`GetBooking` maintains a **module-level in-memory cache** within each Lambda execution environment. The cache key is `bookingReferenceId`; the TTL depends on the status value returned from DynamoDB:

| Status        | Cache TTL | Rationale                                                          |
| ------------- | --------- | ------------------------------------------------------------------ |
| `IN_PROGRESS` | 3 s       | Workflow completes in seconds; stale data would mislead the client |
| `CONFIRMED`   | 60 s      | Terminal state; value never changes                                |
| `FAILED`      | 60 s      | Terminal state; value never changes                                |

Cache entries are stored as `{ value, expiresAt }` tuples in a module-scope `Map`. On each invocation the function checks the cache before calling DynamoDB; a miss or expired entry triggers a fresh `GetItem` and repopulates the cache.

**Trade-offs:**
- Each warm execution environment maintains its own cache. Under high concurrency, multiple environments may each perform one DynamoDB read per TTL window. This is still a substantial reduction in DynamoDB reads and eliminates redundant round-trips within a single container.
- No external cache (ElastiCache, DAX) is needed, keeping the architecture simple and cost-free.
- Cache TTLs are exposed as CDK context parameters (`cacheTtlInProgress`, `cacheTtlTerminal`).

### API Key Authentication

All API Gateway routes require an `x-api-key` header. Keys are issued through the **`booking-usage-plan`** and distributed out-of-band to authorised clients. Requests without a valid key are rejected by API Gateway with `403 Forbidden` before reaching Lambda.

The Usage Plan enforces **per-route throttling** as a cost-free guard against accidental over-use and enumeration:

| Route               | Steady-state RPS | Burst RPS |
| ------------------- | ---------------- | --------- |
| `PUT /ticket`       | 10               | 50        |
| `GET /booking/{id}` | 50               | 100       |

API key auth is intentionally lightweight — it provides client identity and a throttle boundary suitable for a course assignment. For production use, Cognito or IAM-based authentication would be layered on top.

### PUT /ticket — WAF Rate Limiting

The WAF Web ACL (`booking-waf`) is associated directly with the API Gateway stage and contains a **rate-based rule** scoped to `PUT /ticket`, providing a per-IP guard against accidental duplicate submissions and abuse that complements the Usage Plan throttle:

```
RateBasedStatement:
  AggregateKeyType: IP
  Limit: <putRateLimitCount>          # default: 60 (= 1 req / 5 s per IP over a 5-min window)
  EvaluationWindowSec: 300
  ScopeDownStatement:
    ByteMatchStatement:
      FieldToMatch: UriPath → /ticket
      SearchString: /ticket
      PositionalConstraint: EXACTLY
```

Requests that exceed the limit receive a `429 Too Many Requests` response directly from WAF, before reaching API Gateway or Lambda.

**Configuration** (CDK context):

| Parameter            | Default | Description                                                     |
| -------------------- | ------- | --------------------------------------------------------------- |
| `enablePutRateLimit` | `true`  | Set to `false` to disable the WAF rule (e.g., for stress tests) |
| `putRateLimitCount`  | `60`    | Max requests per IP per 5-minute window                         |

When `enablePutRateLimit` is `false`, the WAF Web ACL remains attached to API Gateway but the rate-based rule is removed, allowing unlimited throughput from any IP.

### Lambda Concurrency Isolation

Without explicit allocation, a traffic spike on any one function can exhaust the account concurrency pool and throttle all other functions. Reserved concurrency creates hard ceilings that prevent noisy-neighbour saturation across the five Lambdas (see the concurrency table in the API & Compute section).

### StartExecution Idempotency

`booking-initiator` writes `IN_PROGRESS` to DynamoDB before calling `states:StartExecution`. A transient failure of `StartExecution` would leave the DynamoDB record without a running
workflow. Two mechanisms address this:

1. **Named executions.** The Step Functions execution is named using the `bookingReferenceId`
   (e.g., `booking-<uuid>`). If `booking-initiator` retries `StartExecution` with the same
   name (up to 3 attempts with exponential backoff), Step Functions returns the ARN of the
   already-running execution rather than creating a duplicate. This makes the call idempotent.

2. **Compensating status update.** If all retry attempts fail, `booking-initiator` issues a
   compensating `UpdateItem` that sets the booking status to `FAILED` before returning a
   `503 Service Unavailable`. The record is retained in DynamoDB for audit purposes. The client
   receives no `bookingReferenceId` and may retry the full `PUT /ticket` request, which creates
   a fresh UUID and a new execution.

---

## Future Enhancements

The following capabilities are intentionally deferred from the baseline architecture. Each is a valid production concern but adds cost or operational complexity disproportionate for a course assignment. They are self-contained upgrades that can be layered onto the existing design.

### Multi-AZ Interface Endpoints

Deploying Interface Endpoints in both `private-subnet-a` and `private-subnet-b` eliminates the cross-AZ latency for Lambdas in AZ-b routing to endpoint ENIs in AZ-a, and removes the endpoint from the single-AZ failure domain. Expected additional cost: ~\$22/month (doubling current endpoint spend from \$22 to \$44/month).

### Custom Domain (Route 53 + ACM)

A Route 53 hosted zone with an alias A record pointing to the API Gateway custom domain provides a stable, human-readable URL and TLS certificate lifecycle management via ACM. Requires a registered domain name. Useful when the API URL needs to remain stable across CDK redeployments.

### Provisioned Concurrency with Application Auto Scaling

`GetBooking` is on the synchronous user-facing path. Provisioned concurrency eliminates Lambda cold starts on this path. Application Auto Scaling on a schedule — scale up before expected peak hours, scale down overnight — avoids paying for idle warm instances around the clock.

### KMS Customer-Managed Key (CMK)

Replacing AWS-managed encryption keys with a CMK (`booking-cmk`) gives explicit control over key rotation, cross-account access policies, and detailed key-usage audit trails via CloudTrail. Required for most compliance frameworks (SOC 2, PCI DSS).

Cost: ~\$1/month + $0.03/10,000 API calls.

### AWS Secrets Manager

When the system integrates with a real payment gateway or any external service requiring credentials, Secrets Manager provides centralised storage, automatic rotation, and audit logging. The CDK stack should reference the secret ARN from context rather than embedding credentials in environment variables.

### VPC Flow Logs

Capturing accepted and rejected traffic on all ENIs in the VPC delivers a network-level audit trail useful for incident investigation and compliance reviews. Flow logs are delivered to a dedicated CloudWatch Logs log group (`/aws/vpc/booking-flow-logs`) and incur data-ingestion and storage costs.

### CloudWatch Anomaly Detection

An ML-trained baseline on Lambda duration (`lambda-duration-anomaly`) alerts on statistical deviations from normal execution patterns — catching latency regressions that fixed thresholds would miss. This is the anomaly detection mechanism listed as an **Advanced Deliverable** in the project requirements ['README.md']('https://github.com/DevOpsGroup20/DevOpsGroup20/blob/dev/README.md').
