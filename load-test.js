import http from "k6/http";
import { check } from "k6";

// test configuration
export const options = {
  scenarios: {
    constant_request_rate: {
      executor: "constant-arrival-rate",
      rate: 30,
      timeUnit: "1s",
      duration: "300s",
      preAllocatedVUs: 200,
      maxVUs: 300,
    },
  },

  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% of requests must complete under 500ms
    http_req_failed: ["rate<0.01"], // less than 1% request failure rate
  },
};

// test scenario
export default function () {
  // simulate request
  const response = http.put(
    "https://xppmj4925e.execute-api.eu-central-1.amazonaws.com/Prod/ticket",
  );

  // validate response
  check(response, {
    "status is 202": (r) => r.status === 202,
    "response time is acceptable": (r) => r.timings.duration < 3000,
  });
}
