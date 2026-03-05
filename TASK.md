# DevOps Project

Objective: Migrate a service to the cloud
Target Cloud Provider: AWS

## Introduction

A company has developed a ticket booking system based on a workflow engine and several service tasks. While the system works correctly in a local or semi-manual environment, it is not cloud-native and cannot reliably handle fluctuating user demand, failures, or operational monitoring.
The company now wants to move this system to the cloud and operate it as a cloud-native application. They are particularly interested in elasticity, reliability, observability, and cost awareness. Your task is to redesign, deploy, and operate this system using modern Cloud and DevOps practices, while keeping the core business logic the same.

## Requirements

1. Develop a flexible and elastic online ticket booking prototype.
2. Implement continuous service operation with features such as monitoring, anomaly warnings, and fast response times.

## Expected Output

### Minimal requirements

1. A working cloud-deployed ticket booking system
2. Use of DevOps practices (CI/CD, automation, configuration management)
3. Infrastructure capable of handling concurrent requests with autoscaling
4. A monitoring dashboard with alerting
5. A documented cost estimation

### Advanced Deliverables (If time allows)

1. Optimizing response times using advanced optimization techniques
2. Implementing anomaly detection mechanisms to identify unusual system behavior (e.g., latency spikes, error-rate increases, scaling anomalies, or unexpected resource usage)

## Service Implementation

The architecture of the solution can be modified freely as long as the three initial "fake services" still stay separated from the rest of the application to demonstrate the achitecture modelling skills. We are also responsible for providing implementation to those fake services (in some minimal extend) such that the following client criteria are met:

- We store tuples of (bookingReferenceId: uuid, status: enum, ticketId: uuid)
- Status can be: IN_PROGRESS, CONFIRMED, FAILED
- We need an async API. We submit a booking request and the user should immediately receive bookingReferenceId (HTTP 202 Accepted)
- There should be two endpoints: PUT /ticket and GET/booking/{bookingReferenceNumber}
- The GET /booking endpoint should return the row from the database. The status and the bookingReferenceId are NOT NULL, but ticketId is getting assigned only after the successful workflow
- We can still keep the failure flag `simulateBookingFailure`, and add some other to simulate abnormal behavior
