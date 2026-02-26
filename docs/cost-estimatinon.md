## Cost Estimation

### AWS Components

Our architecture uses the following AWS services:

- **API Gateway** - for HTTP request routing
- **Step Functions** - for workflow orchestration
- **DynamoDB** - for data storage
- **SQS FIFO** - for message queuing
- **Lambda** - for serverless compute
- **CloudWatch** - for logging and monitoring
- **X-Ray** - for distributed tracing

### Pricing Model

Based on AWS pricing for the eu-central-1 (Frankfurt) region:

| Component      | Cost                                                       |
| -------------- | ---------------------------------------------------------- |
| API Gateway    | \$3.7 for first 333m requests                              |
| Step Functions | \$0.000025 per state transition                            |
| DynamoDB       | \$0.31 per GB, \$0.76 per 100k transactions                |
| SQS FIFO       | First 1M requests free - then \$0.5 per 1M                 |
| Lambdas        | \$0.20 per 1m requests, \$0.0000166667 for every GB-second |
| CloudWatch     | \$0.50 per GB of logs                                      |
| X-Ray          | \$5 per million traces                                     |

### Cost Analysis by Load Scenario

The following scenarios represent the **actual expected operational loads** of the system and are used for cost estimation purposes. Note that 150 req/s is the maximum peak load used exclusively for load testing (see README section 9).

**Low Load**: ~5,000 requests/day (150k/month)
**Medium Load**: ~20,000 requests/day (600k/month)

| Component      | Low Load   | Medium Load |
| -------------- | ---------- | ----------- |
| API Gateway    | \$3.7      | \$3.7       |
| Step Functions | \$26.25    | \$105       |
| DynamoDB       | \$8        | \$32        |
| SQS FIFO       | Free       | Free        |
| Lambdas        | \$0.5      | \$2         |
| CloudWatch     | \$2        | \$8         |
| X-Ray          | \$0.75     | \$3         |
| **Total Cost** | **\$41.2** | **\$153.7** |

### Conclusion

The analysis demonstrates that costs scale linearly with request load, while remaining economical across both scenarios.
