import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "https://x").replace(/\/$/, "");
const POLL_INTERVAL_SECONDS = 0.2;
const MAX_POLL_SECONDS = 120;

const bookingFailedRate = new Rate("booking_failed_rate");
const bookingFlowErrorRate = new Rate("booking_flow_error_rate");
const bookingCompletionLatency = new Trend("booking_completion_latency", true);
const bookingsStarted = new Counter("bookings_started");
const bookingsCompleted = new Counter("bookings_completed");
const bookingsFailed = new Counter("bookings_failed");

export const options = {
  scenarios: {
    booking_put_ramp_up: {
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 300,
      maxVUs: 1500,
      stages: [{ target: 150, duration: "2m" }],
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

export default function () {
  bookingsStarted.add(1);

  const putResponse = http.put(`${BASE_URL}/ticket`, null, {
    headers: { "Content-Type": "application/json" },
  });

  const putOk = check(putResponse, {
    "PUT /ticket accepted": (r) => r.status === 202,
  });

  if (!putOk) {
    bookingFailedRate.add(true);
    bookingFlowErrorRate.add(true);
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
        return;
      }

      if (normalizedStatus.includes("FAIL")) {
        bookingFailedRate.add(true);
        bookingsFailed.add(1);
        return;
      }
    }

    sleep(POLL_INTERVAL_SECONDS);
  }

  bookingFailedRate.add(true);
  bookingFlowErrorRate.add(true);
  bookingsFailed.add(1);
}
