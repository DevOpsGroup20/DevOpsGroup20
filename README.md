# DevOpsGroup20
DevOps and Cloud-based software. 2026. University of Amsterdam. Group 20. 


## High Level Architecture Diagram

┌─────────────────────────────────────────────────────────────────┐
│                           USER REQUEST                          │
│  POST /booking {customer, ticketCount, simulateFailure?}        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│  API GATEWAY (HTTP API)                                         │
│  • Routes: POST /booking                                        │
│  • Throttling & rate limiting                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAMBDA: BookingOrchestrator (Node.js)                          │
│  • Validate request                                             │
│  • Generate bookingId                                           │
│  • Start Step Functions execution                               │
│  • Return 202 Accepted {bookingId}                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP FUNCTIONS (Express Workflow)                              │
│  • Orchestrate: Reserve → Pay → Ticket                          │
│  • Enforce payment timeout                                      │
│  • Retry ticket generation on failure                           │
│  • Compensation: Release seats on payment failure               │
│  • Execution logs → CloudWatch                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ↓              ↓              ↓
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ LAMBDA:         │ │ LAMBDA:         │ │ LAMBDA:         │
│ ReserveSeats    │ │ ProcessPayment  │ │ GenerateTicket  │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ • Mock seat     │ │ • Send message  │ │ • Mock ticket   │
│   reservation   │ │   to queue      │ │   generation    │
│ • Simulated     │ │ • Wait for      │ │ • Simulated     │
│   failures      │ │   callback      │ │   failures      │
│ • Return fake   │ │ • Simulated     │ │ • Return fake   │
│   reservationId │ │   timeouts      │ │   ticketUrl     │
└─────────────────┘ └────────┬────────┘ └─────────────────┘
                             │
                             ↓
                    ┌─────────────────┐
                    │ SQS             │
                    │ (payment-queue) │
                    ├─────────────────┤
                    │ • Async message │
                    │   processing    │
                    └────────┬────────┘
                             │
                             ↓
                    ┌─────────────────┐
                    │ LAMBDA:         │
                    │ PaymentHandler  │
                    ├─────────────────┤
                    │ • Consume queue │
                    │ • Mock payment  │
                    │   processing    │
                    │ • Simulated     │
                    │   failures      │
                    │ • Callback to   │
                    │   Step Functions│
                    └─────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  OBSERVABILITY                                                  │
├─────────────────────────────────────────────────────────────────┤
│  X-RAY          • Distributed tracing across all services       │
│  CloudWatch     • Structured logs                               │
│  CloudWatch     • Custom metrics (success rate, latency, etc)   │
│  CloudWatch     • Dashboard (request rate, errors, performance) │
│  CloudWatch     • Alarms (error rate, latency thresholds)       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE (Terraform)                                     │
├─────────────────────────────────────────────────────────────────┤
│  • API Gateway HTTP API                                         │
│  • Lambda Functions (zip deployment, Node.js)                   │
│  • Step Functions Express State Machine                         │
│  • SQS Queue                                                    │
│  • IAM Roles & Policies                                         │
│  • CloudWatch Log Groups                                        │
│  • CloudWatch Dashboard                                         |