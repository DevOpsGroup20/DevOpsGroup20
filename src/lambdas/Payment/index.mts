import { SQSHandler } from "aws-lambda";
import { randomUUID } from "crypto";
import {
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
  SFNClient,
} from "@aws-sdk/client-sfn";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

type BookingEvent = Record<string, unknown> & {
  simulateBookingFailure?: string;
};

type PaymentMessage = {
  taskToken: string;
  bookingReferenceId: string;
  payload: BookingEvent;
};

const sfn = new SFNClient({});
const dynamodb = new DynamoDBClient({});

function parseMessage(body: string): PaymentMessage {
  const parsed = JSON.parse(body);

  if (
    !parsed ||
    typeof parsed.taskToken !== "string" ||
    typeof parsed.bookingReferenceId !== "string" ||
    typeof parsed.payload !== "object" ||
    parsed.payload === null
  ) {
    throw new Error("InvalidPaymentQueueMessage");
  }

  return parsed as PaymentMessage;
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    let taskToken: string | undefined;

    try {
      const message = parseMessage(record.body);
      taskToken = message.taskToken;

      if (message.payload.simulateBookingFailure === "payment") {
        throw new Error("SimulatedPaymentFailure");
      }

      const paymentConfirmationId = randomUUID();

      await dynamodb.send(
        new UpdateItemCommand({
          TableName: process.env.BOOKINGS_TABLE_NAME,
          Key: {
            bookingReferenceId: { S: message.bookingReferenceId },
          },
          UpdateExpression:
            "SET paymentConfirmationId = :paymentConfirmationId, updatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":paymentConfirmationId": { S: paymentConfirmationId },
            ":updatedAt": { S: new Date().toISOString() },
          },
        }),
      );

      await sfn.send(
        new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify({
            ...message.payload,
            paymentConfirmationId,
          }),
        }),
      );
    } catch (error) {
      if (taskToken) {
        await sfn.send(
          new SendTaskFailureCommand({
            taskToken,
            error: "PaymentProcessingFailed",
            cause: error instanceof Error ? error.message : "UnknownError",
          }),
        );
      }
    }
  }
};
