import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "https://x").replace(/\/$/, "");
const TEST_DURATION_SECONDS = 60;
const PUT_RATE_PER_SECOND = 150;
const POLL_INTERVAL_SECONDS = 0.2;
const MAX_POLL_SECONDS = 120;
const SIMULATED_FAILURE_PROBABILITY = 0.3;

const bookingFailedRate = new Rate("booking_failed_rate");
const bookingFlowErrorRate = new Rate("booking_flow_error_rate");
const bookingCompletionLatency = new Trend("booking_completion_latency", true);

const injectedFailureRate = new Rate("injected_failure_rate");
const injectedFailureObservedAsFailedRate = new Rate(
  "injected_failure_observed_as_failed_rate",
);
const nonInjectedObservedAsCompletedRate = new Rate(
  "non_injected_observed_as_completed_rate",
);

const bookingsStarted = new Counter("bookings_started");
const bookingsCompleted = new Counter("bookings_completed");
const bookingsFailed = new Counter("bookings_failed");
const injectedFailures = new Counter("injected_failures");
const injectedSeatFailures = new Counter("injected_seat_failures");
const injectedPaymentFailures = new Counter("injected_payment_failures");
const injectedTicketFailures = new Counter("injected_ticket_failures");

const failureTypes = ["seats", "payment", "ticket"];

export const options = {
  scenarios: {
    booking_failures_constant_rate: {
      executor: "constant-arrival-rate",
      rate: PUT_RATE_PER_SECOND,
      timeUnit: "1s",
      duration: `${TEST_DURATION_SECONDS}s`,
      preAllocatedVUs: 300,
      maxVUs: 1500,
    },
  },
  summaryTrendStats: ["min", "avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function extractBookingId(payload) {
  if (!payload || typeof payload !== "object") return null;

  return (
    payload.bookingId ||
    payload.bookingReferenceID ||
    payload.bookingReferenceId ||
    payload.id ||
    null
  );
}

function extractBookingStatus(payload) {
  if (!payload || typeof payload !== "object") return null;

  return (
    payload.bookingStatus ||
    payload.status ||
    payload.state ||
    payload.booking?.bookingStatus ||
    null
  );
}

function pickFailureType() {
  return failureTypes[Math.floor(Math.random() * failureTypes.length)];
}

export default function () {
  bookingsStarted.add(1);

  const shouldInjectFailure = Math.random() < SIMULATED_FAILURE_PROBABILITY;
  const simulatedFailureType = shouldInjectFailure ? pickFailureType() : null;

  injectedFailureRate.add(shouldInjectFailure);

  const body = shouldInjectFailure
    ? JSON.stringify({ simulateBookingFailure: simulatedFailureType })
    : "{}";

  if (shouldInjectFailure) {
    injectedFailures.add(1);
    if (simulatedFailureType === "seats") injectedSeatFailures.add(1);
    if (simulatedFailureType === "payment") injectedPaymentFailures.add(1);
    if (simulatedFailureType === "ticket") injectedTicketFailures.add(1);
  }

  const putResponse = http.put(`${BASE_URL}/ticket`, body, {
    headers: { "Content-Type": "application/json" },
  });

  const putOk = check(putResponse, {
    "PUT /ticket accepted": (r) => r.status === 202,
  });

  if (!putOk) {
    bookingFailedRate.add(true);
    bookingFlowErrorRate.add(true);
    if (shouldInjectFailure) {
      injectedFailureObservedAsFailedRate.add(false);
    } else {
      nonInjectedObservedAsCompletedRate.add(false);
    }
    bookingsFailed.add(1);
    return;
  }

  let bookingId = null;
  try {
    bookingId = extractBookingId(putResponse.json());
  } catch (_) {
    bookingId = null;
  }

  if (!bookingId) {
    bookingFailedRate.add(true);
    bookingFlowErrorRate.add(true);
    if (shouldInjectFailure) {
      injectedFailureObservedAsFailedRate.add(false);
    } else {
      nonInjectedObservedAsCompletedRate.add(false);
    }
    bookingsFailed.add(1);
    return;
  }

  const startedAt = Date.now();
  const deadline = startedAt + MAX_POLL_SECONDS * 1000;

  while (Date.now() < deadline) {
    const getResponse = http.get(
      `${BASE_URL}/booking/${encodeURIComponent(String(bookingId))}`,
      {
        headers: { Accept: "application/json" },
      },
    );

    if (getResponse.status === 200) {
      let bookingStatus = null;
      try {
        bookingStatus = extractBookingStatus(getResponse.json());
      } catch (_) {
        bookingStatus = null;
      }

      const normalizedStatus = String(bookingStatus || "").toUpperCase();

      if (normalizedStatus.includes("COMPLETED")) {
        bookingFailedRate.add(false);
        bookingsCompleted.add(1);
        bookingCompletionLatency.add(Date.now() - startedAt);

        if (shouldInjectFailure) {
          injectedFailureObservedAsFailedRate.add(false);
        } else {
          nonInjectedObservedAsCompletedRate.add(true);
        }

        return;
      }

      if (normalizedStatus.includes("FAIL")) {
        bookingFailedRate.add(true);
        bookingsFailed.add(1);

        if (shouldInjectFailure) {
          injectedFailureObservedAsFailedRate.add(true);
        } else {
          nonInjectedObservedAsCompletedRate.add(false);
        }

        return;
      }
    }

    sleep(POLL_INTERVAL_SECONDS);
  }

  bookingFailedRate.add(true);
  bookingFlowErrorRate.add(true);
  if (shouldInjectFailure) {
    injectedFailureObservedAsFailedRate.add(false);
  } else {
    nonInjectedObservedAsCompletedRate.add(false);
  }
  bookingsFailed.add(1);
}
