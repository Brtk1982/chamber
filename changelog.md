# 🕳️ Chamber — Changelog

A simple record of meaningful updates to the Chamber project.  
No marketing fluff — just transparency and progress.

---

## 🧱 v1.1 — Stability & Idle Update
**Date:** 2025-11-21  

### Added
- Static notice reminding users that idle sessions may auto-close.  

### Changed
- Extended Socket.IO heartbeat interval and timeout (now allows ~2.5 min idle before disconnect).  
- Updated documentation and deployment flow for smoother GitHub → Render sync.  

### Fixed
- Occasional short-idle disconnections during normal use.

> *Not the most convenient — but one function, done right.*

---

## 🪶 v1.0 — Initial Public Release
**Date:** 2025-10-XX  

### Added
- Core two-person encrypted chat system.  
- Ephemeral room creation with timed expiry.  
- In-memory architecture (no databases, no logs).  
- Basic rate-limiting and room auto-cleanup.

> *Freedom doesn’t need permission.*

---

