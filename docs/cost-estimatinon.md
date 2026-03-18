## Cost Estimation

### AWS Components

Our architecture uses the following AWS services:

- **API Gateway** - for REST request routing
- **Express Step Functions** - for workflow orchestration
- **DynamoDB** - for data storage
- **Lambda** - for serverless compute
- **CloudWatch** - for observability
- **X-Ray** - for distributed tracing

### Pricing Model

Based on AWS pricing for the eu-central-1 (Frankfurt) region:

| Component              | Cost                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| API Gateway            | \$3.70 per million for first 333 million requests                                                           |
| Express Step Functions | \$1.00 per million requests + \$0.00001667 per GB-Second for first 1,000 GB-hours                           |
| DynamoDB               | \$0.31 per GB of storage + complex read/write pricing for on-demand capacity                                |
| Lambdas                | \$0.20 per 1m requests + \$0.0000166667 for every GB-second                                                 |
| CloudWatch             | \$0.63 per GB of logs + \$3.00 per dashboard per month + \$0.10 per alarm metric                            |
| X-Ray                  | \$5 per million traces recorded + \$1.00 per million stored + \$0.50 per 1 million traces scanned/retrieved |

### Cost Analysis by Load Scenario

The following scenarios represent the **actual expected operational loads** of the system and are used for cost estimation purposes. Note that 150 req/s is the maximum peak load used exclusively for load testing (see README section 9).

**Low Load**: ~5,000 requests/day (150k/month)
**Medium Load**: ~20,000 requests/day (600k/month)

| Component              | Low Load    | Medium Load |
| ---------------------- | ----------- | ----------- |
| API Gateway            | \$1.11      | \$4.44      |
| Express Step Functions | \$0.31      | \$1.24      |
| DynamoDB               | \$1.16      | \$5.26      |
| Lambdas                | \$1.30      | \$5.19      |
| CloudWatch             | \$5.00      | \$9.50      |
| X-Ray                  | \$2.10      | \$8.40      |
| **Total Cost**         | **\$10.98** | **\$34.03** |

### Conclusion

The analysis demonstrates that costs scale linearly with request load, while remaining economical across both scenarios.
