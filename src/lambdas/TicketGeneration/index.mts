import { Handler } from "aws-lambda";
import { randomUUID } from "crypto";

type BookingEvent = Record<string, unknown> & {
  simulateBookingFailure?: string;
};

export const handler: Handler<BookingEvent, BookingEvent> = async (event) => {
  if (event.simulateBookingFailure === "ticket") {
    throw new Error("SimulatedTicketGenerationFailure");
  }

  return {
    ...event,
    ticketId: randomUUID(),
  };
};
