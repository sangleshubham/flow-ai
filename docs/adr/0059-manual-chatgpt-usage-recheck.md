# 0059 — Manual access checks after a ChatGPT usage-limit error

- Status: accepted
- Date: 2026-10-17
- Workstream: W2, W9
- Spec sections: §9, §14, §15; amends ADR 0055 and ADR 0057

## Context

The user reported restored ChatGPT capacity while the reader continued rejecting Retry locally. The gateway persists a pause after `subscription_sharing_usage_limit_exceeded`, defaulting to 30 minutes when OpenAI supplies no retry interval. The pane incorrectly presented that local deadline as a verified ChatGPT reset time. Whole-book Resume also refused to check access until the saved deadline passed.

[OpenAI's recovery guidance](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery) says this code alone establishes neither exhaustion of the entire plan nor a reset time. The user explicitly requested a code fix covering manual retries, accurate wording, and upstream diagnostics. This authorizes the W2 gateway/transport/API and W9 pane/runtime changes together; frozen core and pipeline contracts remain unchanged.

## Decision

Keep automatic generation paused after a usage-limit error, with no automatic retry or paid-provider fallback. Explicit Retry and whole-book Resume may request a fresh check through `x-illus-recheck-plan-limit: 1` on the next LLM request. That permission is consumed once and expires after one minute if unused. Authentication and ordinary request validation still apply.

While the account is paused, the gateway allows one check at a time and at most one every ten seconds per account. Other accounts remain independent. A successful upstream completion clears only the persisted pause observed by that check, preserving a newer pause written by another request. Another usage-limit response stops the request immediately and keeps the account paused. Checks retain normal handling of unsupported formats, unavailable models and temporary failures; usage-limit responses themselves are never automatically retried.

Call all stored deadlines **local pauses**, including legacy records and provider retry intervals; do not claim a confirmed plan reset. Explain that Retry/Resume checks access again. Retain the upstream status, code, parameter and request ID in each failed call's existing per-account usage JSON. Return the original usage-limit message and request ID to the authenticated caller for diagnosis. Do not persist raw provider bodies, credentials or prompts in these diagnostics.

## Consequences

No dependencies, database migration, frozen IR changes or credential changes are required. This bug fix updates existing gateway and pane behavior without a new feature flag. Existing stored pauses can be checked immediately. The check limiter is in memory under ADR 0055's single-process deployment constraint; restarting the process resets its short cooldown but preserves account pauses. A real OpenAI limit can still reject the fresh check.

Regression coverage uses fake Responses API streams and local SQLite only, covering successful recovery, repeat rejection, simultaneous checks, account isolation, durable pause clearing, HTTP header forwarding and accurate pane wording. No live model calls are needed to verify the fix.
