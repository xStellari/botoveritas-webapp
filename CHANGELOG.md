# Changelog
All notable changes to the BotoVeritas Web Application are documented in this file.

The format follows a simplified version of Keep a Changelog and uses
clear, descriptive entries suitable for academic and project review.

---

## [Unreleased]

---

## [2026-01-13] – Results PDF and System Reliability Updates

### Added
- Automated Results PDF generation using a Supabase Edge Function.
- Visual election summaries and per-position vote tallies in generated reports.
- Administrative support component for organization membership requests.

### Fixed
- Abstain vote handling in charts to prevent zero-count entries from appearing.
- Inconsistencies between ranked results, summaries, and database vote counts.
- Turnout calculation to correctly use eligible voters as the denominator.
- Voting submission flow to prevent multiple submissions and improve feedback.
- Voter session expiration to prevent permanent kiosk lockout.
- Election lifecycle workflow issues related to finalizing and archiving elections.

### Improved
- Readability and layout consistency of generated election result reports.
- Stability of election management user interface during finalize and archive actions.
- Administrative routing and structural organization of the web application.

---
