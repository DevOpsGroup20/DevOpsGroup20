# Load Test Results Summary

The tables below summarize four executed scenarios defined in the load testing 

## 1) Ramp-Up Load (0 → 150 RPS over 2 minutes)

| Metric                        |                          Value | Notes                                   |
| ----------------------------- | -----------------------------: | --------------------------------------- |
| Scenario                      | Ramp from 0 to 150 RPS over 2m | Happy path                              |
| Execution Time p50            |                      294.67 ms | k6 `iteration_duration med`             |
| Execution Time p99            |                      405.26 ms | k6 `iteration_duration p(99)`           |
| Execution Time max            |                      799.62 ms | k6 `iteration_duration max`             |
| Booking failed rate           |                 0.00% (0/8999) | No business-flow failures               |
| Expected failure handling     |     N/A (no injected failures) | No failures expected                    |
| Expected success handling     |                           PASS | All expected-success bookings succeeded |
| README success criteria check |                           PASS | No booking errors during ramp-up        |

## 2) Steady-State Load (150 RPS, 5 minutes)

| Metric                        |                      Value | Notes                                      |
| ----------------------------- | -------------------------: | ------------------------------------------ |
| Scenario                      |             150 RPS for 5m | Happy path                                 |
| Execution Time p50            |                  292.52 ms | k6 `iteration_duration med`                |
| Execution Time p99            |                  388.73 ms | k6 `iteration_duration p(99)`              |
| Execution Time max            |                  986.43 ms | k6 `iteration_duration max`                |
| Booking failed rate           |            0.00% (0/45000) | All bookings completed                     |
| Expected failure handling     | N/A (no injected failures) | No failures expected                       |
| Expected success handling     |                       PASS | All expected-success bookings succeeded    |
| README success criteria check |                       PASS | Error rate <1%, p99 completion latency <3s |

## 3) Failure Simulation Load (150 RPS, 1 minute)

| Metric                               |                                     Value | Notes                                                      |
| ------------------------------------ | ----------------------------------------: | ---------------------------------------------------------- |
| Scenario                             | 150 RPS for 1m with 30% injected failures | Failure simulation                                         |
| Execution Time p50                   |                                 292.87 ms | k6 `iteration_duration med`                                |
| Execution Time p99                   |                                 396.19 ms | k6 `iteration_duration p(99)`                              |
| Execution Time max                   |                                 584.31 ms | k6 `iteration_duration max`                                |
| Injected failure rate                |                        30.84% (2776/9000) | Close to target 30%                                        |
| Failure split                        |     seats: 900, payment: 902, ticket: 974 | Approximately balanced (~10% each overall)                 |
| Injected failures observed as FAILED |                       100.00% (2776/2776) | All expected-fail cases failed                             |
| Non-injected observed as COMPLETED   |                       100.00% (6224/6224) | All expected-success cases succeeded                       |
| Verification statement               |                                      PASS | Server response behavior matches failure simulation design |

## 4) Spike Load (300 RPS, 30 seconds)

| Metric                        |                      Value | Notes                                           |
| ----------------------------- | -------------------------: | ----------------------------------------------- |
| Scenario                      |            300 RPS for 30s | Happy path spike                                |
| Execution Time p50            |                  294.01 ms | k6 `iteration_duration med`                     |
| Execution Time p99            |                  409.96 ms | k6 `iteration_duration p(99)`                   |
| Execution Time max            |                     1.33 s | k6 `iteration_duration max`                     |
| Booking failed rate           |             0.00% (0/9001) | No business-flow failures                       |
| Expected failure handling     | N/A (no injected failures) | No failures expected                            |
| Expected success handling     |                       PASS | All expected-success bookings succeeded         |
| README success criteria check |                       PASS | System sustained spike with no booking failures |
