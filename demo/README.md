# Demo UI

A frontend demo application for the AWS bookings API, served via nginx in a Docker container.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

## Running with Docker

### 1. Build the image

```bash
docker build -t devops-demo .
```

### 2. Run the container

```bash
docker run -p 8080:80 -e API_BASE_URL=<your-api-url> devops-demo
```

Replace `<your-api-url>` with the base URL of your deployed API (e.g. `https://abc123.execute-api.eu-west-1.amazonaws.com/prod`).

The app will be available at [http://localhost:8080](http://localhost:8080).

### Environment variables

| Variable | Description | Required |
|---|---|---|
| `API_BASE_URL` | Base URL of the bookings API | Yes |

## Features

The demo lets you interact with the ticket booking API and observe the full booking workflow in real time.

**Single booking** — trigger one booking at a time and watch it progress through three steps: seat reservation, payment, and ticket issuance. Each step is shown live as the UI polls for status updates.

**Burst mode** — fire 25 or 100 concurrent bookings in one click. The burst view shows a progress bar, success/failure counts, and aggregate backend latency stats (average and P95).

**Failure simulation** — optionally inject failures at a specific workflow step (seats, payment, or ticket), or configure per-step failure probabilities using a draggable slider. Useful for demonstrating the API's error handling and Step Functions compensation logic.

**Latency metrics** — each completed booking shows backend processing time, total client-side elapsed time, and poll overhead so you can reason about the async workflow's performance.
