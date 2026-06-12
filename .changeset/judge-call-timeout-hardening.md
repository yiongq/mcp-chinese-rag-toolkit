---
'@yiong/mcp-chinese-rag-toolkit': patch
---

Eval: harden `callJudge` timeout handling. A judge rejection arriving after the timeout already degraded the call is now observed by a no-op handler instead of surfacing as an unhandled rejection (a process crash by default in Node); a rejection that loses no race still propagates unchanged. Finite `timeoutMs` values above 2^31-1 (the largest delay `setTimeout` honours) are now capped instead of being silently clamped to ~1ms, which previously turned a huge "effectively no timeout" budget into an instant spurious timeout on every call. The same cap applies to `rewriteQuery`'s `timeoutMs`.
