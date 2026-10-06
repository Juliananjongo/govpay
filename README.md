# GovPay

GovPay is a Zambia-focused public-service application and payment platform. The repository includes a React interface, Supabase authentication and database foundations, row-level access policies, and Flutterwave Zambia mobile-money integration.

## Current status

This is a **sandbox/staging implementation, not a production government service**. The Supabase schema and Edge Functions are source code only until deployed and configured. No real government services are connected, and the sample service catalog and sandbox workspaces are not official records. Do not collect real citizen data or accept live payments until the launch checklist below is complete.

In local Vite development, the interface defaults to a clearly labelled simulator with sample records and simulated payment outcomes. To exercise the backend integration, set `VITE_SANDBOX_MODE=false` and configure a Supabase staging project and Flutterwave test credentials. Production builds always use the backend path; they do not use the browser simulator.

## Run the interface locally

```sh
npm install
Copy-Item .env.example .env.local
npm run dev
```

Vite uses port `8443` by default. If that port is occupied, run `npm run dev -- --port 8444`. The simulator works without Supabase credentials. Build the frontend with `npm run build`.

## Configure a staging backend

1. Create a Supabase project and install the Supabase CLI.
2. Copy the project URL and publishable/anon key into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Keep `VITE_SANDBOX_MODE=true` for the simulator; set it to `false` only when deliberately testing the configured backend.
3. Link the CLI and apply the database migration:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

4. Add reviewed service records with `active=true` in the Supabase dashboard or a separately reviewed seed. The migration intentionally does not publish fictional services as live offerings.
5. Configure Flutterwave test-mode credentials and the site origin as Supabase Edge Function secrets:

   ```sh
   supabase secrets set FLW_SECRET_KEY=YOUR_TEST_SECRET_KEY FLW_SECRET_HASH=YOUR_WEBHOOK_SECRET_HASH SITE_URL=http://localhost:8443
   ```

   Supabase provides its project URL and API keys to Edge Functions. Never put Flutterwave secrets or a Supabase service-role key in frontend variables.
6. Deploy the functions:

   ```sh
   supabase functions deploy create-checkout
   supabase functions deploy verify-checkout
   supabase functions deploy flutterwave-webhook
   ```

7. In Flutterwave test-mode settings, configure the webhook URL as `https://YOUR_PROJECT_REF.supabase.co/functions/v1/flutterwave-webhook`, set the webhook secret hash to the same value as `FLW_SECRET_HASH`, and enable charge-completed events.
8. Start Vite with `VITE_SANDBOX_MODE=false`, register a test account, add a valid ZMW service, and test the Zambia mobile-money authorization and webhook flow with Flutterwave test credentials.

The payment integration uses Flutterwave's Zambia-specific mobile-money charge endpoint. It accepts MTN, Airtel, or Zamtel, requires a Zambian mobile number, and verifies transactions server-side before marking invoices paid.

## Before any live launch

- Complete a successful end-to-end test using the merchant's approved account and credentials, including retries, duplicate/out-of-order webhooks, payment failures, and reconciliation.
- Have the merchant/provider confirm Zambia ZMW mobile-money enablement, account ownership, settlement, fees, refunds, and applicable regulatory obligations.
- Replace sample service data and sandbox workspace screens with formally approved live services, authorized staff workflows, audit trails, and reporting.
- Review identity proofing, role provisioning, recovery, privacy notices, retention, encryption, accessibility, threat model, operational support, backups, monitoring, incident response, and deployment controls.
- Conduct independent security and legal/compliance reviews, then run staging and production smoke tests. No production project, credentials, transaction, or deployment is included in this repository.

## Project checks

```sh
npm run build
```
