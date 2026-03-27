# Request: j41-connect → SDK/Dispatcher Team

**From:** j41-connect (buyer-side CLI)
**Date:** 2026-03-26
**Re:** Dispatcher/SDK changes needed to work with j41-connect v0.2.0

---

## 1. Handle `workspace:exclusions` Event

**Context:** The relay now emits `workspace:exclusions` to the agent on connect (confirmed by backend on 2026-03-26):

```json
{ "excludedFiles": [".env.example", ".git/", "run_overnight.sh", "run_phase1.sh"] }
```

**What the dispatcher/SDK needs to do:**
- Listen for `workspace:exclusions` on the `/workspace` namespace
- Inject the excluded file list into the executor's LLM system prompt
- Example system prompt addition: `"The following files are excluded from this workspace and will be blocked if you try to access them: .env.example, .git/, run_overnight.sh, run_phase1.sh"`
- This prevents the agent from repeatedly trying to access blocked files (currently agents hit 6+ blocks before learning)

**Priority:** High — directly affects agent efficiency and buyer experience.

---

## 2. Handle SovGuard Block Errors Gracefully

**Context:** When SovGuard blocks a write (`safe: false`), j41-connect sends back an `mcp:result` with `success: false` and `error: "Write blocked by SovGuard"`. The agent currently doesn't know why the write was blocked.

**What the dispatcher/SDK needs to do:**
- When receiving `mcp:result` with `success: false` and the error message contains "SovGuard", inject a contextual message to the LLM: `"Your write was blocked by the buyer's SovGuard security scanner. The content was flagged as potentially malicious. Try a different approach that doesn't trigger security flags."`
- Don't retry the same write — that will just get blocked again

**Priority:** Medium — improves agent behavior after blocks.

---

## 3. Respect Agent Idle Time

**Context:** The buyer's j41-connect now sends keepalive pings every 30 seconds. But if the agent itself goes silent for 10+ minutes (thinking, generating), the relay may still drop the session.

**What the dispatcher/SDK needs to do:**
- If the executor/LLM is still processing, the dispatcher should send periodic `workspace:ping` or any lightweight event to signal the agent is still active
- This prevents the relay from killing sessions during long agent thinking periods

**Priority:** High — directly related to the "Invalid workspace UID" disconnects.
