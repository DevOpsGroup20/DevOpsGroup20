import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { Handler } from "aws-lambda";
import { randomUUID } from "crypto";

type BookingEvent = Record<string, unknown> & {
  simulateBookingFailure?: string;
};

const dynamoDbClient = new DynamoDBClient({});

export const handler: Handler<BookingEvent, BookingEvent> = async (event) => {
  const seatCapacityTableName = process.env.SEAT_CAPACITY_TABLE_NAME;
  if (!seatCapacityTableName) {
    throw new Error("SEAT_CAPACITY_TABLE_NAME is required");
  }

  if (event.simulateBookingFailure === "seats") {
    throw new Error("SimulatedSeatReservationFailure");
  }

  try {
    await dynamoDbClient.send(
      new UpdateItemCommand({
        TableName: seatCapacityTableName,
        Key: {
          id: {
            S: "CAPACITY",
          },
        },
        UpdateExpression: "SET availableSeats = availableSeats - :dec",
        ConditionExpression: "availableSeats >= :min",
        ExpressionAttributeValues: {
          ":dec": {
            N: "1",
          },
          ":min": {
            N: "1",
          },
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new Error("NoSeatsAvailable");
    }
    throw error;
  }

  return {
    ...event,
    reservationId: randomUUID(),
  };
};
