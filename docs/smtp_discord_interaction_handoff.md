# SMTP Validation and Discord Interaction Issue Handoff

Date: 2026-06-30
Project: WhatsApp / ingestion system

## Summary

There are two related issues in the current system:

1. Discord dashboard button interactions for SMTP account enable/disable sometimes fail with "This interaction failed" or appear to do nothing.
2. SMTP validation logic is rejecting some accounts that should be valid, including a previously working Gmail account, and the system disables those accounts during the pre-enable validation flow.

These issues are currently blocking reliable SMTP account management from the dashboard and making account enablement inconsistent.

---

## 1) Problem Description

### A. Discord interaction error

When a user clicks an SMTP toggle button in the Discord dashboard, the interaction can fail in one of these ways:

- The bot shows "This interaction failed"
- The button press appears to do nothing
- The UI does not update correctly after enabling/disabling an SMTP account
- The interaction is acknowledged late or in the wrong way, causing Discord to reject it

This appears to be connected to the SMTP toggle button handler in the Discord bot.

### B. SMTP validation / enable issue

When an SMTP account is enabled, the system runs a validation routine before marking it active. In some cases this validation rejects an account even though it should be usable.

The user reported that a previously working Gmail account, `tahalakti@gmail.com`, can no longer be enabled after the validation logic change.

---

## 2) What Was Observed

### Server-side symptoms

During debugging, the following messages were observed in server logs and runtime output:

- `early smtp-toggle catch`
- `deferUpdate failed (interaction may already be acknowledged)`
- `InteractionAlreadyReplied`
- `Unknown interaction`
- `smtp-validator: account validation failed, disabling`
- `smtp_validation_failed: ...`
- `535 BadCredentials`
- `503 AUTH command used when not advertised`
- `Greeting never received`
- `SMTP account enable failed: ...`

These logs suggest that the issue is not only a UI problem but also a backend SMTP validation problem.

---

## 3) Relevant Files

The issue is centered around the following files:

- [src/discord/botHandlers.ts](src/discord/botHandlers.ts)
  - Discord button interaction handling
  - SMTP toggle flow and dashboard UI updates

- [src/smtp/validator.ts](src/smtp/validator.ts)
  - Main SMTP account validation and enable/disable logic

- [src/smtp/connection.ts](src/smtp/connection.ts)
  - SMTP connection probing logic
  - Candidate config generation for host/port/TLS combinations

- [src/smtp/sender.ts](src/smtp/sender.ts)
  - Mail sending path that also validates SMTP config before sending

- [src/api/routes/index.ts](src/api/routes/index.ts)
  - API routes for SMTP account creation, enablement, and updates

- [src/db/repositories/smtp.ts](src/db/repositories/smtp.ts)
  - Database operations for enabling/disabling/updating SMTP accounts

- [src/security/crypto.ts](src/security/crypto.ts)
  - Password decryption used during SMTP validation

---

## 4) Current Technical Behavior

### Discord side

The Discord handler currently tries to acknowledge button interactions quickly using `deferUpdate()` for SMTP toggles and then updates the message afterward.

The problem appears to be that the flow mixes several interaction patterns:

- deferral
- follow-up messages
- message edit
- update
- reply

Discord is strict about how an interaction should be acknowledged, and mixing these in the wrong order can cause failures.

### SMTP validation side

The SMTP validation flow currently does the following:

1. Reads the SMTP account from the database
2. Decrypts the stored password
3. Tries to connect and login using a set of candidate SMTP configurations
4. If no candidate works, it marks the account as disabled

The validator uses a candidate list that includes combinations of:

- current host/port
- port 587
- port 465
- port 25
- different TLS/STARTTLS behavior

That logic is probably too aggressive for some providers, especially Gmail-like services, because a valid account can still fail validation if the auth flow or TLS negotiation differs from what the probe expects.

---

## 5) Likely Root Cause Areas

### A. Interaction handling bug

The most likely issue is that the Discord button handler is not consistently following a single interaction pattern.

Possible causes:

- The interaction is deferred and then later treated as if it were still available for a regular update/reply
- A follow-up message is sent after the interaction was already replied to or updated
- The original message edit sometimes fails and leaves the interaction in a bad state

### B. SMTP validation too strict

The current SMTP validation tries several connection configs and disables the account if all fail.

Possible causes:

- The validation logic is rejecting a valid account because one specific config path is wrong or too strict
- The logic is not matching the actual successful auth flow for Gmail or similar providers
- The validation step is being used as a hard gate for enabling an account instead of as a warning/diagnostic check

### C. Possible credential or config mismatch

There is also a possibility that the stored password, host, port, or TLS setting is not exactly what the SMTP provider expects.

The validation routine depends on:

- decrypted password from the DB
- host/port/use_tls from the DB
- current SMTP provider behavior

If any of those are slightly off, the validation can fail even for a working account.

---

## 6) Current Impact

- SMTP toggle buttons in the Discord dashboard are unreliable
- Users may get a generic interaction failure instead of a useful error message
- Valid SMTP accounts may be disabled by the pre-enable validation routine
- The previously working Gmail account `tahalakti@gmail.com` is a concrete example of a valid account being blocked by the current validation flow

---

## 7) Recommended Next Steps for the Colleague

1. Reproduce the issue with a known-good SMTP account, especially Gmail.
2. Capture the full validation attempts and error messages from the SMTP validator.
3. Review the Discord interaction flow in [src/discord/botHandlers.ts](src/discord/botHandlers.ts) and ensure it uses one consistent acknowledgement strategy.
4. Compare the validator logic in [src/smtp/connection.ts](src/smtp/connection.ts) with the working mail-sending flow in [src/smtp/sender.ts](src/smtp/sender.ts).
5. Decide whether SMTP validation should be a soft check that reports problems without immediately disabling the account, or whether it should remain a hard enable gate.
6. Verify the stored SMTP account data in the database, especially host, port, TLS flag, and encrypted password.

---

## 8) Short Version

The system currently has a dual issue:

- Discord button interactions are failing because the interaction handling flow is inconsistent.
- SMTP validation is too aggressive and may mark valid accounts as disabled, including the Gmail account that used to work.

This handoff should be used as the starting point for debugging both problems.

---

## 9) Resolution (Fixed on 2026-06-30)

Both issues have been successfully identified and resolved.

### A. Discord Interaction Bug Resolution
**Root Cause**: 
The `src/discord/botHandlers.ts` file contained three overlapping and duplicate handler blocks for the `dashboard:smtp-toggle` button. Additionally, the interaction pattern was violating Discord API rules: the code called `await interaction.deferUpdate()` (which acknowledges the interaction), but later incorrectly called `await interaction.update(...)` or `interaction.message.edit(...)` instead of the required `interaction.editReply(...)`. This mix caused the "This interaction failed" error and UI desyncs.

**Fix**:
- Deleted the two redundant fallback `smtp-toggle` handlers from the bottom of the file.
- Consolidated the logic in the primary early-catch handler.
- Refactored the flow to strictly call `interaction.deferUpdate()` once, perform the database queries and validation, and then properly call `interaction.editReply({ content: ..., components: ... })` to update the dashboard UI. Errors now correctly trigger `interaction.followUp()`.

### B. SMTP Validation Bug Resolution
**Root Cause**: 
In `src/smtp/connection.ts`, the validation algorithm (`connectAndLogin`) was manually cycling through multiple port and TLS combinations using the low-level `smtp-connection` module. This manual socket probing bypassed `nodemailer`'s intelligent defaults and negotiation mechanisms (like proper STARTTLS upgrade flows). As a result, strict providers like Gmail rejected the manual probes as invalid or unauthenticated flows, causing perfectly valid accounts to be disabled.

**Fix**:
- Completely removed the manual `SMTPConnection` probing logic from `connectAndLogin`.
- Replaced it with the robust, standard validation method: `nodemailer.createTransport(buildTransportOptions(...)).verify()`.
- This ensures the validation check uses the *exact same* connection logic and options as the actual mail-sending function (`src/smtp/sender.ts`). If an account can send emails, it will now correctly pass validation without being falsely disabled.
