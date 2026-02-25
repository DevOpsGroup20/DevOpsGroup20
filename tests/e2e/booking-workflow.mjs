import assert from "node:assert/strict";

const baseUrl = (process.env.BOOKING_API_BASE_URL ?? "").replace(/\/$/, "");
const pollIntervalMs = Number(process.env.BOOKING_POLL_INTERVAL_MS ?? 1000);
const pollTimeoutMs = Number(process.env.BOOKING_POLL_TIMEOUT_MS ?? 60000);

if (!baseUrl) {
  throw new Error("BOOKING_API_BASE_URL is required");
}

const scenarios = [
  {
    name: "happy-path",
    input: {},
    expectedStatus: "COMPLETED",
    requiredFields: ["reservationId", "paymentConfirmationId", "ticketId"],
    absentFields: [],
  },
  {
    name: "seats-failure",
    input: { simulateBookingFailure: "seats" },
    expectedStatus: "FAILED",
    requiredFields: [],
    absentFields: ["reservationId", "paymentConfirmationId", "ticketId"],
  },
  {
    name: "payment-failure",
    input: { simulateBookingFailure: "payment" },
    expectedStatus: "FAILED",
    requiredFields: ["reservationId"],
    absentFields: ["paymentConfirmationId", "ticketId"],
  },
  {
    name: "ticket-failure",
    input: { simulateBookingFailure: "ticket" },
    expectedStatus: "FAILED",
    requiredFields: ["reservationId", "paymentConfirmationId"],
    absentFields: ["ticketId"],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getBookingStatus(booking) {
  return booking.bookingStatus ?? booking.status;
}

function getBookingReferenceId(startResponse) {
  if (typeof startResponse.bookingReferenceID === "string") {
    return startResponse.bookingReferenceID;
  }

  if (typeof startResponse.bookingID === "string") {
    return startResponse.bookingID;
  }

  if (typeof startResponse.bookingReferenceId === "string") {
    return startResponse.bookingReferenceId;
  }

  if (typeof startResponse.id === "string") {
    return startResponse.id;
  }

  if (typeof startResponse.executionArn === "string") {
    const arnParts = startResponse.executionArn.split(":");

    // Express execution ARN includes an extra trailing execution id segment.
    if (arnParts[5] === "express" && arnParts.length >= 2) {
      return arnParts[arnParts.length - 2];
    }

    return arnParts[arnParts.length - 1];
  }

  return undefined;
}

async function startBooking(payload) {
  const response = await fetch(`${baseUrl}/ticket`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  const body = parseJson(bodyText);

  if (!response.ok) {
    throw new Error(`PUT /ticket failed (${response.status}): ${bodyText}`);
  }

  const bookingReferenceId = body ? getBookingReferenceId(body) : undefined;
  if (!bookingReferenceId) {
    throw new Error(
      `Could not extract bookingReferenceId from response: ${bodyText}`,
    );
  }

  return bookingReferenceId;
}

async function readBooking(bookingReferenceId) {
  const response = await fetch(`${baseUrl}/booking/${bookingReferenceId}`, {
    method: "GET",
  });

  if (response.status === 404) {
    return undefined;
  }

  const bodyText = await response.text();
  const body = parseJson(bodyText);

  if (!response.ok) {
    throw new Error(
      `GET /booking/${bookingReferenceId} failed (${response.status}): ${bodyText}`,
    );
  }

  if (!body || typeof body !== "object") {
    throw new Error(
      `GET /booking/${bookingReferenceId} returned non-JSON body: ${bodyText}`,
    );
  }

  return body;
}

async function waitForFinalBooking(bookingReferenceId) {
  const deadline = Date.now() + pollTimeoutMs;

  while (Date.now() < deadline) {
    const booking = await readBooking(bookingReferenceId);

    if (booking) {
      const status = getBookingStatus(booking);
      if (status === "COMPLETED" || status === "FAILED") {
        return booking;
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for booking ${bookingReferenceId} to complete`,
  );
}

function assertScenarioResult(scenario, booking, bookingReferenceId) {
  assert.equal(
    booking.bookingReferenceId,
    bookingReferenceId,
    `[${scenario.name}] bookingReferenceId mismatch`,
  );

  assert.equal(
    getBookingStatus(booking),
    scenario.expectedStatus,
    `[${scenario.name}] unexpected final booking status`,
  );

  for (const field of scenario.requiredFields) {
    assert.equal(
      typeof booking[field],
      "string",
      `[${scenario.name}] expected field ${field} to be set`,
    );
    assert.notEqual(
      booking[field],
      "",
      `[${scenario.name}] expected field ${field} to be non-empty`,
    );
  }

  for (const field of scenario.absentFields) {
    assert.ok(
      booking[field] === undefined ||
        booking[field] === null ||
        booking[field] === "",
      `[${scenario.name}] expected field ${field} to be absent`,
    );
  }
}

async function run() {
  console.log(`Testing booking workflow against ${baseUrl}`);

  for (const scenario of scenarios) {
    console.log(`\\n[${scenario.name}] starting`);

    const bookingReferenceId = await startBooking(scenario.input);
    const booking = await waitForFinalBooking(bookingReferenceId);

    assertScenarioResult(scenario, booking, bookingReferenceId);

    console.log(
      `[${scenario.name}] passed with status=${getBookingStatus(booking)}`,
    );
  }

  console.log("\\nAll booking workflow scenarios passed");
}

await run();
