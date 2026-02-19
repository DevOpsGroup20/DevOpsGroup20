# DevOpsGroup20
DevOps and Cloud-based software. 2026. University of Amsterdam. Group 20.

#### Project Team
- Bjorgvin Atli Juliusson (bjorgvin.juliusson@student.uva.nl)
- Kacper Machaj (kacper.machaj@student.uva.nl)
- Hubert Mazur (hubert.mazur@student.uva.nl)
- Dimitris Thomopoulos (dimitris.thomopoulos@student.uva.nl)

# Project Requirements & Scope

## Overview

This project involves migrating a ticket booking system from **Camunda Cloud (orchestration-as-a-service)** to a **serverless AWS architecture** while preserving the core business logic and workflow orchestration patterns.

---

## In Scope

### 1. Core Logic (Must Preserve)

#### Three-Step Booking Workflow
The system must execute three sequential steps to complete a booking:

1. **Reserve Seats** - Check availability and reserve the requested seats
2. **Process Payment** - Handle payment processing with a 30-second timeout
3. **Generate Ticket** - Create the ticket document with retry logic

Each step must complete successfully before proceeding to the next.

#### Compensation Logic (Saga Pattern)
If any step fails, the system must gracefully fail and conclude the booking process.

- **Payment fails/times out** → Release reserved seats.
- **Ticket generation fails** → Release reserved seats.
- **Seat reservation fails** → No compensation needed (nothing to rollback)

This ensures no partial bookings exist in the system.

#### Timeout Enforcement
- Payment processing **must complete within 30 seconds**
- If timeout occurs, seats must be automatically released
- Other steps have no explicit timeout requirements

#### Retry Logic
- **Seat reservation** → Fail immediately, no retries
- **Payment processing** → No retries, enforce 30-second timeout
- **Ticket generation** → Multiple retry attempts with exponential backoff

#### Failure Simulation
The system must support simulated failures for testing:
- `simulateBookingFailure=seats` → Force seat reservation to fail
- `simulateBookingFailure=payment` → Force payment to fail/timeout
- `simulateBookingFailure=ticket` → Force ticket generation to fail

This allows testing of compensation logic without external dependencies.

---

### 2. API Requirements

#### Create Booking Endpoint
**Endpoint:** `PUT /ticket`

**Behavior:**
- Accept booking requests (with optional failure simulation parameter)
- Generate a unique `bookingReferenceId`
- Store initial booking record in database with status `PENDING`
- Start the workflow asynchronously
- Return `202 Accepted` immediately with the booking ID
- Do not block waiting for workflow completion

**Query Parameters:**
- `simulateBookingFailure` (string, optional) - Simulate failure at specific step: `"seats"`, `"payment"`, or `"ticket"`

**Response:**
`202 Accepted`
```json
{
  "bookingReferenceId": "uuid-string"
}
```
or (if `simulateBookingFailure == "seats"`)

`404 Not Found` if seat reservation fails:
```json
{
  "error": "ErrorSeatsNotAvailable"
}
```

#### Get Booking Status Endpoint
**Endpoint:** `GET /booking/{bookingReferenceId}`

**Behavior:**
- Query the database for the booking record
- Return booking status and any completed step data

**Response:**
```json
{
  "bookingReferenceId": "uuid",
  "status": "PENDING" | "COMPLETED" | "FAILED",
  "reservationId": "string (if available)",
  "paymentConfirmationId": "string (if available)",
  "ticketId": "string (if available)"
}
```

---

### 3. Workflow Orchestration

The system must:
- **Orchestrate** the three-step workflow (Check Availability → Pay → Ticket)
- **Coordinate** compensation logic when failures occur
- **Track** workflow state and execution history
- **Enforce** timeouts and retry policies
- **Execute** steps in strict sequential order
- **Update** booking status in database as workflow progresses

In the current system, Camunda/Zeebe handles this orchestration. In the new system, **AWS Step Functions** will handle it.

---

### 4. Mock Services

Since this is a demonstration system, the three service implementations are **fake/mock services**:

#### Reserve Seats Service
- Simulate seat availability logic
- Generate fake `reservationId`
- Update booking record in database with `reservationId`
- Optionally fail based on `simulateBookingFailure` parameter

#### Payment Service
- Simulate payment processing with 2-second delay
- Generate fake `paymentConfirmationId`
- Update booking record in database with `paymentConfirmationId`
- Optionally timeout or fail based on simulation parameter
- No actual payment gateway integration required

#### Ticket Generation Service
- Simulate ticket creation
- Generate fake `ticketId` or ticket URL
- Update booking record in database with `ticketId`
- Optionally fail to trigger retry logic
- No actual PDF generation or storage required

**Key Point:** We are **not building real services**. We are demonstrating workflow orchestration, fault tolerance, and compensation patterns using mock implementations.

---

### 5. Data Persistence

The system must maintain booking state and seat availability in a database:

#### Database Schema

**Bookings Table** stores:
- `bookingReferenceId` (primary key, UUID) - Generated on initial PUT request
- `status` (string) - Current workflow state: `PENDING`, `COMPLETED`, `FAILED`
- `reservationId` (string, nullable) - Set after successful seat reservation
- `paymentConfirmationId` (string, nullable) - Set after successful payment
- `ticketId` (string, nullable) - Set after successful ticket generation
- `createdAt` (timestamp) - When booking was created
- `updatedAt` (timestamp) - Last status update

**SeatCapacity Table** stores:
- `id` (primary key, string) - Fixed value (e.g., "CAPACITY")
- `totalSeats` (number) - Total capacity (e.g., 100)
- `availableSeats` (number) - Current available seats, decremented on reservation, incremented on cancellation/compensation

#### Database Technology
- Use **Amazon DynamoDB** for serverless, scalable storage
- Single-table design for Bookings with `bookingReferenceId` as partition key
- Single-row table for SeatCapacity with atomic updates for concurrency safety
- No complex queries or relational logic required

#### Update Pattern
- Lambda functions update the database after each successful step
- Step Functions triggers status updates via Lambda
- Reserve Seats service performs atomic decrement on `availableSeats`
- Compensation logic performs atomic increment to restore capacity
- Database serves as source of truth for booking state and seat availability

---

### 6. Observability & Monitoring

The system must provide:

#### Distributed Tracing
- Trace requests across all Lambda functions
- Visualize the complete workflow execution path
- Identify bottlenecks and failures
- Use **AWS X-Ray** for distributed tracing

#### Structured Logging
- Log all workflow events in JSON format
- Include context (bookingId, step name, timestamps)
- Use **CloudWatch Logs** for centralized logging

#### Metrics & Dashboards
- Track success rates, failure rates, latency
- Monitor timeout occurrences and retry attempts
- Create dashboards showing request rate, errors, and performance
- Use **CloudWatch Metrics & Dashboards**

#### Alerting
- Alert on error rate thresholds
- Alert on latency degradation
- Use **CloudWatch Alarms** with appropriate thresholds

---

### 7. Infrastructure as Code

All infrastructure must be defined and deployed using **CloudFormation**:

- API Gateway HTTP API
- Lambda functions (5 total: orchestrator, 3 workers, status checker)
- Step Functions state machine
- DynamoDB tables (Bookings and SeatCapacity)
- SQS queue (for async payment processing)
- IAM roles and policies
- CloudWatch log groups, dashboards, and alarms
- X-Ray tracing configuration

The infrastructure should be:
- **Repeatable** - Can be deployed multiple times without manual intervention
- **Version controlled** - All infrastructure code in Git

---

### 8. Technology Migration

Migrate from current stack to serverless AWS:

| Current | New (Serverless) |
|---------|------------------|
| Camunda Cloud (Zeebe) | AWS Step Functions |
| Java Spring Boot REST API | AWS API Gateway + Lambda |
| Node.js Zeebe workers | AWS Lambda (Node.js) |
| RabbitMQ (AMQP) | AWS SQS |
| Zeebe gRPC | Direct Lambda invocation |
| Camunda workflow engine | Step Functions state machine |
| N/A | Amazon DynamoDB |

---

## Out of Scope

### Real Service Implementations

**We are NOT building:**
- Actual seat inventory management system
- Real payment gateway integration (Stripe, PayPal, etc.)
- Actual PDF ticket generation
- Complex database schema for seat availability
- Customer management system
- Email/SMS notification systems
- Ticket delivery mechanisms

**We ARE building:**
- Simple booking state persistence (DynamoDB)
- Basic seat capacity tracking (single-row table)
- Basic booking record storage with IDs and status

---

## Success Criteria

The project is successful if:

**Workflow orchestration works correctly:**
- Three steps execute in sequence
- Timeouts are enforced (30s for payment)
- Retries work (ticket generation)
- Compensation executes on failure
- Database is updated at each step

**Scalability**
- 150 requests to book tickets per second
- System remains responsive under load
- No timeouts or errors occur - unless failure is being simulated

**API is functional:**
- `PUT /ticket` returns 202 with bookingId and creates database record
- `GET /booking/{id}` returns current status from database
- Failure simulation works as expected

**Data persistence works:**
- Booking records are created on PUT
- Status and IDs are updated as workflow progresses
- Seat capacity is tracked and updated atomically
- GET endpoint returns accurate data from database

**Observability is in place:**
- X-Ray traces show complete workflow
- CloudWatch logs capture all events
- Dashboard shows key metrics
- Alarms trigger on error conditions

**Infrastructure is reproducible:**
- CloudFormation deploys entire stack (including DynamoDB tables)
- No manual configuration required
- Can tear down and redeploy

**Cost is low and clearly reported**

---

## Non-Goals

**This project is not about:**
- Building a production-ready ticket booking system
- Complex database design or query optimization
- Data migration or backup strategies

**This project is about:**
- Demonstrating serverless workflow orchestration
- Showing how to migrate from managed orchestration to serverless
- Proving cost savings of serverless architecture
- Building observable, fault-tolerant workflows
- Learning AWS Step Functions and Lambda patterns
- Basic state persistence for workflow tracking

---

## Summary

**In one sentence:** Migrate the ticket booking workflow from Camunda Cloud to AWS serverless (Step Functions + Lambda + DynamoDB), preserving the three-step saga pattern with compensation logic, storing booking state and IDs in a database with simple seat capacity tracking, while keeping service logic mocked and infrastructure simple.

----

## High Level Architecture Diagram
![High Level Architecture Diagram](architecture/architecture_diagram.svg)
