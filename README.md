# prachtirrigation-workorder-system
# filename: /README.md
# Pracht Irrigation Work Order System

This repository contains a Supabase-backed Work Order System with two static web apps:

- **Office Dashboard** (`/office`) for dispatch, invoicing, and administration
- **Tech App** (`/tech`) for field technicians (mobile-first + offline queue)

## 1) Create a Supabase project
1. Create a new Supabase project.
2. Copy the **Project URL** and **Anon Key** from the API settings.

## 2) Apply the database schema
1. Open the Supabase SQL editor.
2. Run the full contents of `/supabase/schema.sql`.
3. Run the full contents of `/supabase/seed.sql`.

## 3) Storage bucket + policies
The schema SQL creates the `job_reports` bucket and basic open access policies suitable for local development.
For production, tighten policies to restrict access by `org_id` and authenticated roles.

## 4) Configure environment variables
These apps are static and read config from `localStorage` or `window` globals:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `ORG_ID`

To set once per browser, open DevTools and run:

```js
localStorage.setItem('SUPABASE_URL', 'https://YOUR_PROJECT.supabase.co');
localStorage.setItem('SUPABASE_ANON_KEY', 'YOUR_ANON_KEY');
localStorage.setItem('ORG_ID', '11111111-1111-1111-1111-111111111111');
