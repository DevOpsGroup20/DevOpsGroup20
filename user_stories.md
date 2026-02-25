# User Stories

## End User Stories

### 1) Initiate a booking
**As an** end user,  
**I want to** initiate a new booking process,  
**so that** I can go to the event I love.

**Acceptance Criteria**
- Given I send `PUT /ticket`, when the request is valid, then I receive `202 Accepted`.
- The response includes a non-empty `bookingReferenceId`.
- The workflow starts asynchronously in the background.
- If I provide a failure simulation flag, the system handles it according to workflow rules.

### 2) Track booking progress
**As an** end user,  
**I want to** check my booking status at any time,  
**so that** I can see whether my booking is still processing, completed, or failed.

**Acceptance Criteria**
- Given a valid booking reference, when I call `GET /booking/{bookingReferenceId}`, then I receive current status and available IDs.
- Status transitions are visible (`PENDING` → `COMPLETED` or `FAILED`).
- If booking is complete, `ticketId` is returned.
- If booking does not exist, the API returns `404`.

## Developer Stories

### 3) CI/CD automation
**As a** developer,  
**I want** automated CI checks on pull requests,  
**so that** quality issues are caught early and integration is safer.

**Acceptance Criteria**
- On each PR, pipeline runs build, deploy to LocalStack, and E2E tests.
- Pipeline fails if any scenario fails.
- Logs are available for troubleshooting.
- Manual trigger is available for reruns.

### 4) Infrastructure as Code
**As a** developer,  
**I want** all cloud resources defined in IaC templates,  
**so that** environments are reproducible and version controlled.

**Acceptance Criteria**
- API, Lambda, Step Functions, DynamoDB, IAM, and Logs are defined in template files.
- Stack can be created and deleted with scripted commands.
- Changes are reviewable via Git diffs.
- No manual cloud console setup is required.

## Product Owner Story

### 5) Progress visibility via Jira
**As a** product owner,  
**I want** all work tracked on a Jira board,  
**so that** I can monitor delivery progress, priorities, and blockers.

**Acceptance Criteria**
- Every feature/task has a Jira ticket with clear status.
- Sprint board reflects current state (To Do / In Progress / Done).
- Tickets include acceptance criteria and ownership.
- Weekly progress can be summarized from Jira.

## Scrum Master Stories

### 6) Clear team communication
**As a** scrum master,  
**I want** a dedicated WhatsApp group for fast coordination,  
**so that** blockers and updates are communicated quickly.

**Acceptance Criteria**
- All team members are in the group.
- Team uses the channel for blockers, decisions, and reminders.
- Important decisions are summarized and linked back to Jira when needed.

### 7) Regular progress syncs
**As a** scrum master,  
**I want** daily standups on Wednesday and Thursday,  
**so that** I can ensure alignment and remove blockers quickly.

**Acceptance Criteria**
- Standups are scheduled and recurring on Wednesday and Thursday.
- Each member reports: progress, next steps, blockers.
- Blockers are assigned owners and tracked to resolution.
- Summary is reflected in Jira updates.
