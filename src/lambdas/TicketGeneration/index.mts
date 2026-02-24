import { Handler } from "aws-lambda";
import { randomUUID } from "crypto";

export const handler: Handler<object, object> = async event => {
  return {
    ...(event as object),
    ticketId: randomUUID(),
  };
};
