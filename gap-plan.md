# Discord Delivery Plan

## Goal

Make Phase 1 feel like a usable product in Discord, while keeping Phase 2 open for refinement and polish.

## What Phase 1 Must Prove

- The client can open Discord and see the system surface.
- The client can trigger ingestion from a link or source path.
- The client can see queue, status, logs, account state, and sending controls.
- The client can verify that the backend is actually doing the work.

## What Phase 2 Must Not Block

- Phase 2 is for refinement, not basic operability.
- Phase 2 should improve the experience, not replace the Phase 1 control surface.
- Phase 2 can add richer campaign tools, analytics, dashboards, and stronger orchestration.

---

## Phase 1 Scope

### Step 1: Discord Dashboard Entry Point

Deliver a `/dashboard` command that opens the main operational surface in Discord.

Buttons to expose:

- Ingest Data
- View Queue
- Start Sending
- Logs
- Health
- Status
- Accounts
- Window
- Campaigns
- Pause
- Resume

Acceptance:

- The dashboard opens successfully in Discord.
- Each button returns a meaningful response.
- No hidden manual server action is required for the common flows.

### Step 2: Ingestion Flow

Deliver a button-driven ingest flow with a modal.

Modal fields:

- Download Link / Source Path
- Format

Supported first-pass sources:

- `http(s)` links
- `s3://` paths
- local or file-based source paths where configured

Supported first-pass formats:

- `csv`
- `txt`
- `json`
- `raw`
- `bulk`

Acceptance:

- The client can paste a link in Discord.
- The system queues ingestion and reports the result back in Discord.
- The system rejects unsupported or unreachable links with a clear error.

Important limitation:

- ZIP extraction is not part of the current pipeline, so it must not be promised as Phase 1 capability unless it is explicitly added later.

### Step 3: Queue Visibility

Expose queue state from Discord.

Response should show:

- Waiting
- Active
- Delayed
- Completed
- Failed
- Paused

Acceptance:

- The client can see queue health without leaving Discord.
- The response reflects live backend state, not a mock screen.

### Step 4: Sending Control

Expose sending controls in Discord.

Behavior:

- `Start Sending` should trigger the existing campaign send path.
- `campaign_id` and `dataset_id` are required.
- The response should confirm whether sending was queued or rejected.

Acceptance:

- The client can initiate sending from Discord.
- Sending uses the correct dataset scope.
- Campaign sender metadata is respected by the mailer.

### Step 5: Logs and Health

Expose basic operational visibility.

Response should include:

- Recent logs
- Health status
- Job summary or current job status

Acceptance:

- The client can verify that the system is alive.
- Recent actions are visible from Discord.

### Step 6: Accounts, Window, and Campaign Visibility

Expose the existing configuration state from Discord.

Response should include:

- SMTP accounts
- Sending window settings
- Campaign list
- Pause and resume controls

Acceptance:

- The client can inspect the operational setup from Discord.
- These responses stay short and readable.

---

## Phase 2 Boundary

Phase 2 should only refine what Phase 1 already proves.

Phase 2 may add:

- Rich campaign editor screens
- Recipient previews and targeting helpers
- Historical metrics and charts
- Persistent delivery dashboards
- Concurrency management and queue tuning
- More polished multi-screen Discord UX

Phase 2 must not be required for the client to test or understand Phase 1.

---

## Execution Order

1. Ship the dashboard entry point.
2. Ship the ingest modal and live ingestion response.
3. Ship queue, logs, health, and status visibility.
4. Ship sending, accounts, window, campaign, pause, and resume controls.
5. Validate the flow end to end in Discord.
6. Keep Phase 2 features explicitly out of the critical path.

---

## Success Condition

The client can:

1. Open Discord.
2. Open the dashboard.
3. Submit a link for ingestion.
4. See the ingestion result.
5. Inspect queue, logs, and status.
6. Trigger sending with a dataset.

If that works, Phase 1 is complete enough to defend.
