# CashControl by Hello Sugar

## Overview
CashControl by Hello Sugar is a web tool for Hello Sugar salons to track and reconcile physical cash against Boulevard salon management software. It replaces the Google Form + Sheet process with a system that makes cash counting easy for estheticians, provides early detection of discrepancies, logs receipts for cash spent, and supports audits and periodic cash collections.

## Branding
- **Name**: CashControl by Hello Sugar
- **Primary Color**: Hello Sugar Pink (#FF4FA3 / HSL 330 72% 55%)
- **Font**: Inter (Google Fonts)
- **Logo**: Hello Sugar wordmark logo used in sidebar, headers, and login
- **Design**: Clean, modern, feminine, bright - consistent with hellosugar.salon brand
- **CSS Theme**: Defined as CSS variables in index.css (light and dark mode)

## Architecture
- **Frontend**: React + TypeScript, Vite, TailwindCSS, shadcn/ui components, wouter routing, TanStack Query
- **Backend**: Express.js REST API with session-based admin auth
- **Database**: PostgreSQL with Drizzle ORM
- **File uploads**: Multer for receipt file handling (stored in /uploads directory)
- **CSV parsing**: csv-parse for Boulevard data import
- **OCR**: OpenAI vision (gpt-4o-mini via Replit AI Integrations) for receipt amount extraction
- **SMS Alerts**: Quo API (api.openphone.com) for sending SMS alerts to configured recipients
- **Auth**: Session-based email allowlist for admin portal; esthetician pages are public

## Key Routes
### Esthetician-Facing (no auth required)
- `/count/:locationId` - Location-specific cash count (auto-selects location)
- `/receipt/:locationId` - Location-specific receipt upload (auto-selects location)

### Admin Portal (requires login via email allowlist)
- `/` or `/admin` - Dashboard with stats overview (homepage is admin login)
- `/admin/shifts` - All shift count submissions
- `/admin/receipts` - All uploaded receipts
- `/admin/alerts` - Alert management
- `/admin/collections` - Cash collection events
- `/admin/boulevard` - Boulevard CSV import and data view
- `/admin/markets` - Market management
- `/admin/locations` - Location and container management
- `/admin/estheticians` - Staff list management
- `/admin/recipients` - SMS alert phone numbers
- `/admin/users` - Admin allowlist
- `/admin/settings` - App settings (Quo API key)

## Admin Authentication
- Email-based allowlist (no password required for MVP)
- POST /api/admin/login with { email } - checks against admin_users table
- All admin API routes protected with requireAdmin middleware
- Session stored server-side with express-session
- Default seed admin: admin@hellosugar.salon

## Data Model
- **Markets** - Operating regions (e.g. Dallas, Houston)
- **Locations** - Physical locations, either "suite" or "flagship" type
- **Containers** - Cash containers (suite envelopes or flagship tills)
- **Estheticians** - Staff members who count cash
- **ShiftCounts** - Start/end of shift cash count submissions
- **Receipts** - Uploaded receipt files with amounts
- **BoulevardTransactions** - Imported cash transactions from Boulevard
- **Alerts** - System-generated alerts for discrepancies
- **CashCollections** - Periodic physical cash collection events
- **AdminUsers** - Allowlisted admin email addresses
- **AlertRecipients** - Phone numbers for SMS alerts
- **AppSettings** - Configuration key-value pairs

## Cash Expected Formula
`expected_cash = last_counted_amount + boulevard_cash_since_last_count - receipts_since_last_count`

Time-windowed calculation: Boulevard cash and receipt totals are scoped from the last shift count timestamp to now, not all-time totals.

## Alert Types
- **start_mismatch** - Start count doesn't match expected
- **end_mismatch** - End count doesn't match expected
- **missing_end_shift** - No end-of-shift count within 12 hours of start (checked every 5 min)
- **receipt_submitted** - Receipt uploaded notification
- **collection_mismatch** - Collection amount doesn't match expected

## Location Types
- **Suite**: Up to 2 suites, each counts cash separately, balance accumulates
- **Flagship**: Pooled till, $20 daily float, resets daily
