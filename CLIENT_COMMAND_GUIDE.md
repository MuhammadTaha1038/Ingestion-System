# Client Command Guide

This guide shows the exact commands for using the system in a simple way.
 
## 1. Simple Workflow

Use the system in this order:

1. Check the service is alive with `/health`.
2. Create or list your sender hierarchy with `/cpanel-create`, `/subdomain-create`, and `/email-create`.
3. Create an SMTP account with `/smtp-create`.
4. Upload or send your email list into the system with `/ingest`.
5. Create a campaign with `/campaign-create`.
6. Send that campaign to one specific dataset with `/campaign-send`.
7. Use `/status`, `/queue`, `/metrics`, `/logs`, `/smtp-status`, and `/smtp-failures` to check results.

Important:
- Campaign sends are dataset-scoped. You must choose a `dataset_id` when sending.
- The system will not send a campaign to the whole recipient table.

## 2. Discord Commands

### Service and monitoring

| Command | What it does | Example |
|---|---|---|
| `/dashboard` | Opens the Discord operations dashboard with button-based controls for ingestion, SMTP, campaign management, status, and logs. | `/dashboard` |
| `/health` | Checks whether the service is running. | `/health` |
| `/status` | Shows the latest job summary, or one specific job if you provide a job id. | `/status` or `/status job_id:<job-id>` |
| `/queue` | Shows queue counts for ingestion and sending. | `/queue` |
| `/metrics` | Shows total job counts and SMTP usage totals. | `/metrics` |
| `/logs` | Shows recent logs. You can choose how many lines to show. | `/logs limit:50` |
| `/pause` | Pauses ingestion and sending queues. | `/pause` |
| `/resume` | Resumes ingestion and sending queues. | `/resume` |

### Dashboard buttons

Use `/dashboard` to open the button-driven control panel. The panel includes the key flows for datasets, campaigns, and SMTP operations, including:
- Ingest Data, Ingest New Recipient List, View Datasets, Select Dataset
- View Campaigns, Select Campaign, View Campaign, Create Campaign, Edit Campaign, Delete Campaign
- Run Campaign, Send Test Email, Add Test Recipient, Use Test Recipient
- SMTP List, SMTP Create, SMTP Import
- Queue, Window, Logs, Health, Storage, Campaign Usage

For campaign send operations, you can use `/campaign-send` directly, or use `/dashboard` and the Run Campaign button with a selected dataset.

### Sending window

| Command | What it does | Example |
|---|---|---|
| `/window-show` | Shows the current sending window settings. | `/window-show` |
| `/window-update` | Updates the sending window settings. | `/window-update hours:6 interval_hours:6 start_hour:0 start_minute:0 timezone:Asia/Karachi` |

### cPanel hierarchy

| Command | What it does | Example |
|---|---|---|
| `/cpanel-create` | Creates a cPanel account group. | `/cpanel-create name:Main` |
| `/cpanel-list` | Lists all cPanel account groups. | `/cpanel-list` |
| `/subdomain-create` | Creates a subdomain under a cPanel group. | `/subdomain-create cpanel_id:<cpanel-id> name:mail` |
| `/subdomain-list` | Lists subdomains. You can filter by cPanel id. | `/subdomain-list` or `/subdomain-list cpanel_id:<cpanel-id>` |
| `/email-create` | Creates an email account under a subdomain. | `/email-create subdomain_id:<subdomain-id> address:sender@example.com` |
| `/email-list` | Lists email accounts. You can filter by subdomain id. | `/email-list` or `/email-list subdomain_id:<subdomain-id>` |
| `/accounts-status` | Shows account status overview. | `/accounts-status` |

### SMTP accounts

| Command | What it does | Example |
|---|---|---|
| `/smtp-create` | Creates a new SMTP account. | `/smtp-create email_account_id:<email-account-id> host:smtp.gmail.com username:sender@gmail.com password:<app-password> port:587 use_tls:true max_per_window:50 max_concurrent:1` |
| `/smtp-update` | Updates an existing SMTP account. | `/smtp-update id:<smtp-id> host:smtp.gmail.com port:587 username:sender@gmail.com password:<new-password> use_tls:true max_per_window:50 max_concurrent:1` |
| `/smtp-status` | Shows active SMTP accounts. | `/smtp-status` |
| `/smtp-usage` | Shows SMTP usage for a specific window, or recent windows if no window id is provided. | `/smtp-usage` or `/smtp-usage window_id:<window-id>` |
| `/smtp-failures` | Shows recent SMTP failures. | `/smtp-failures` |
| `/smtp-disable` | Disables one SMTP account. | `/smtp-disable id:<smtp-id>` |
| `/smtp-enable` | Re-enables one SMTP account. | `/smtp-enable id:<smtp-id>` |

### Ingestion

| Command | What it does | Example |
|---|---|---|
| `/ingest` | Imports email data into the system. | `/ingest format:csv content:"name,email\nA,first@example.com"` |

Accepted formats:
- `csv`
- `json`
- `txt`
- `raw`
- `bulk`

You can send data in these ways:
- `content` for pasted text
- `source_path` for a file path or URL
- `file` for an attached file

Example:
- `/ingest format:csv source_path:s3://bucket/file.csv`
- `/ingest format:txt content:"test1@example.com test2@example.com"`

### Campaigns

| Command | What it does | Example |
|---|---|---|
| `/campaign-create` | Creates a campaign. | `/campaign-create name:Promo subject:Hello body_html:<p>Hello</p> smtp_account_email:sender@example.com` |
| `/campaign-update` | Updates an existing campaign. | `/campaign-update id:<campaign-id> subject:New Subject smtp_account_email:sender@example.com status:active` |
| `/campaign-list` | Lists campaigns. | `/campaign-list` |
| `/campaign-send` | Sends one campaign to one dataset only. `dataset_id` is required. | `/campaign-send id:<campaign-id> dataset_id:<dataset-id>` |

Important campaign rules:
- `subject` is required when creating a campaign.
- `name` is required when creating a campaign.
- `body_html` is required when creating a campaign.
- `reply_to` is optional.
- `smtp_account_email` is optional and can be used to bind the campaign to a specific SMTP account.
- Campaign delete is available from the `/dashboard` button UI only.
- When sending, you must provide `dataset_id`.
- The campaign will only send to recipients from that dataset.

## 3. What Each Command Is For

- Use `/health` when you want a quick yes/no check.
- Use `/ingest` when you have a new list of emails.
- Use `/campaign-create` when you want to prepare an email message.
- Use `/campaign-send` when you are ready to send to one dataset.
- Use `/smtp-create` when you want to connect an SMTP mailbox for sending.
- Use `/queue`, `/status`, `/metrics`, and `/logs` when you want to confirm the system is working.

## 4. Recommended Testing Order

1. Run `/health`.
2. Run `/cpanel-list`, `/subdomain-list`, and `/email-list` to confirm sender structure.
3. Run `/smtp-status` to confirm SMTP is active.
4. Run `/ingest` for your test email list.
5. Check `/status` until the ingest job is completed.
6. Run `/campaign-create`.
7. Run `/campaign-send` using the `dataset_id` from the ingest result.
8. Check `/queue`, `/metrics`, and `/logs`.
9. If mail does not arrive, check `/smtp-failures` and `/smtp-usage`.

## 5. Reference API Commands

If you prefer HTTP or need to integrate with another tool, these are the exact API endpoints.

| Method | Endpoint | What it does |
|---|---|---|
| `GET` | `/health` | Service health |
| `POST` | `/ingest` | Start an ingest job |
| `GET` | `/status` | Job summary or one job |
| `GET` | `/queue` | Queue counts |
| `GET` | `/metrics` | Overall metrics |
| `GET` | `/logs` | Recent logs |
| `POST` | `/control/pause` | Pause queues |
| `POST` | `/control/resume` | Resume queues |
| `POST` | `/accounts/cpanel` | Create cPanel group |
| `GET` | `/accounts/cpanel` | List cPanel groups |
| `POST` | `/accounts/subdomain` | Create subdomain |
| `GET` | `/accounts/subdomain` | List subdomains |
| `POST` | `/accounts/email` | Create email account |
| `GET` | `/accounts/email` | List email accounts |
| `POST` | `/smtp/account` | Create SMTP account |
| `GET` | `/smtp/accounts` | List SMTP accounts |
| `PUT` | `/smtp/account/:id` | Update SMTP account |
| `POST` | `/smtp/account/:id/disable` | Disable SMTP account |
| `POST` | `/smtp/account/:id/enable` | Enable SMTP account |
| `GET` | `/smtp/status` | Active SMTP accounts |
| `GET` | `/smtp/usage` | SMTP usage |
| `GET` | `/smtp/failures` | SMTP failures |
| `POST` | `/campaigns` | Create campaign |
| `PUT` | `/campaigns/:id` | Update campaign |
| `GET` | `/campaigns` | List campaigns |
| `POST` | `/campaigns/:id/send` | Send campaign to a dataset |

API note:
- For `/campaigns/:id/send`, send `datasetId` in the request body.

## 6. Important Notes

- Do not use `smtp-list`; that command does not exist.
- Use `/smtp-status` instead.
- `campaign-send` needs a dataset id.
- If you want to test only one new file upload, use the dataset id from that upload.
- If you want help understanding a result, check `/status` first, then `/logs`.
