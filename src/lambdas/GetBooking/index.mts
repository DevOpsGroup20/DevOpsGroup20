import { APIGatewayProxyHandler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({});

export const handler: APIGatewayProxyHandler = async (event) => {
  const bookingReferenceId = event.pathParameters?.id;

  if (!bookingReferenceId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Missing booking id" }),
    };
  }

  const result = await client.send(
    new GetItemCommand({
      TableName: process.env.BOOKINGS_TABLE_NAME,
      Key: { bookingReferenceId: { S: bookingReferenceId } },
    }),
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: "Booking not found" }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(unmarshall(result.Item)),
  };
};
