# YuE2 Bot integration checkpoint

## Scope / approved policy

- Separate worktree `discord-local-llm-bot-yue2-pr`, branch `codex/yue2-bot-integration`, initial base `a0a6c6a`, rebased to latest main `1890ae1` (Othello fixes preserved).
- Preserve the original dirty checkout and parallel draw/reference PR #4. Do not merge or deploy the production Bot in this task; create a PR when verified.
- Default music model YuE2; ACE-Step remains selectable. Duration is a target, not a crop or a minimum; model EOS may occur before/after it.
- Separate hard safety cap 360s (real stress test PASS); explicit truncated metadata; no automatic retry/fade.
- BLUE exact identity pc5700x / DESKTOP-L9HAM1G / 192.168.0.104 / RTX3090 UUID GPU-e5370fc5-8df1-b0ba-15e8-4574ca831b2e. Keep existing ACE/video installations unchanged.
- User approved household LAN access; only required endpoint/rule scoped to the Bot host. BLACK is protected: read-only connection verification only, no restart or settings changes.
- One Bot-wide music queue, max pending bound, idle free after 300s and server-side queue checks. MP3 for Discord; raw FLAC stays on BLUE.

## Phases

- [x] Read policies and inspect repository / fixed YuE2 implementation; isolate worktree.
- [x] Implement workflow + metadata output node (delegated, disjoint files).
- [x] Implement Bot selection / dedicated client / queue and UI settings.
- [x] Add BLUE LAN launcher + narrow firewall setup / rollback; deploy only required integration artifacts.
- [x] Run focused/full unit tests and real idle/capped/natural/240/360-second validation.
- [x] Document acceptance, review parallel-PR overlaps, commit/push and open PR (no merge).

## Current notes

See `docs/yue2-integration-acceptance.md` for verified results. Natural/EOS cases reached 194.96 / 312.2 / 66.6 seconds; stress reached 360 with truncated=true. Peak VRAM16,937MiB. Final MP3 is128kbps. Official /free empty success body support was fixed from real-test evidence. VRAM8,297→1,065MiB; test server stopped after verification. BLUE is prepared for manual start; BLACK production Bot remains unchanged.

Delivery: https://github.com/Haritan4141/discord-local-llm-bot/pull/5 . Final suite after rebase:175 PASS. PR #4 remains separate; its draw imports overlap this PR's music import replacement, so rebase/review both sets of imports when subsequently combining. No main push, merge, or BLACK production deployment was performed by this task.
