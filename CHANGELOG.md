# Changelog

All notable changes to TennisPro Booking are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.3.0] - 2026-03-05
### Changed
- **Home Assistant-style UI redesign** — replaced horizontal top navbar with a
  fixed left navigation sidebar (logo, nav items, user card, dark mode toggle,
  sign-out button), matching HA's familiar panel layout
- Added sticky topbar with page title (left) and user profile chip (right)
  showing name + role with an avatar initials circle
- Mini-calendar sidebar preserved as secondary right panel within main view
- Mobile layout unchanged: left nav hidden, bottom nav and topbar remain

---

## [1.2.0] - 2026-03-05
### Added
- **Real-time updates via WebSocket** — bookings made by any user appear instantly
  for all connected clients without a page refresh
- **Admin user management** — create, edit (name/email/role/password), and delete users
  directly from the Admin panel; guards prevent deleting the last admin or yourself
- WebSocket connection status shown on the System Info page ("● Live" / "○ Offline")
- Live WebSocket client count shown in System Info server stats

### Fixed
- Safari date parsing bug: SQLite `DATETIME` strings (space separator) now parsed
  with a `T` replacement to conform to ISO 8601 — fixes "Invalid Date" / validation
  errors on the Info page and admin users table in Safari/iOS
- Info page error state now shows a Retry button instead of requiring a full refresh
- `apiFetch` now catches non-JSON responses and reports `Server error (status)` instead
  of a cryptic JSON parse exception ("The string did not match the expected pattern")

---

## [1.1.0] - 2026-03-05
### Added
- CHANGELOG.md for version tracking
- Comprehensive inline code comments across all source files
- Event delegation for scheduler interactions (single listener on grid)
- Singleton modal pattern — event listeners wired once at init, never replaced
- Current-time red indicator line in day scheduler
- User initials avatar on booked slots
- Dismiss modal by clicking outside (overlay backdrop)

### Changed
- Full UI/CSS redesign: modern typography, refined color tokens, glassmorphism nav
- Scheduler slot height increased to 64px for easier touch targets
- Booked slots show pill-style indicator with initials + name
- Login page background uses subtle radial gradient
- Dark mode colours tuned for better contrast (WCAG AA)
- Available slot hover shows "+" icon with animated fill

### Fixed
- Booking button did nothing: modal `onclick` was being replaced on each call,
  causing handlers to silently drop — replaced with singleton + fixed listeners
- Login stuck on "Signing in…": login view DOM not cleared before mounting app
- Modal appeared on page load: CSS `display:flex` overrode HTML `hidden` attribute

---

## [1.0.2] - 2026-03-05
### Fixed
- Login page frozen at "Signing in…" after successful auth
  (`app.innerHTML +=` kept login DOM alive behind the main view)

---

## [1.0.1] - 2026-03-05
### Fixed
- Modal (confirm/cancel) appeared on page load with no message, blocking login
  (CSS `display:flex` on `#modal-overlay` overrode the `hidden` attribute)

---

## [1.0.0] - 2026-03-05
### Added
- Initial release
- 5 tennis courts, 10 pre-seeded user accounts + 1 admin account
- Day-view scheduler (7 AM – 9 PM, 1-hour slots)
- Mini month calendar for date navigation
- JWT authentication via httpOnly cookie
- bcrypt password hashing, helmet security headers, rate limiting
- Dark mode with localStorage persistence
- Fully responsive layout (mobile → 4K)
- Admin panel: user list + all bookings with cancel action
