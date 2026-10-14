# FootballAI — separate website

## Features
- Separate responsive football AI website and admin dashboard.
- Manual MTN Mobile Money payments in GHS.
- Registration payment approval is a separate payment type and approval action from credit purchases.
- Fixed credit packages and custom top-ups.
- Variable analysis credit costs: Quick Match Outlook (1), Full Match Analysis (2), Screenshot/Odds Analysis (3), Tactical & Player Analysis (4).
- Credits deducted only after the AI successfully returns an analysis; insufficient credits block analysis.
- PostgreSQL-backed accounts, payment requests, credits and analysis history.
- Owner/admin can approve/reject payments, adjust credits, and edit registration fee, custom top-up conversion, fixed credit package prices/credit quantities, and per-analysis credit costs directly from `/admin`. Pricing settings persist in PostgreSQL and take effect immediately.

## Default price examples
- Starter: 10 credits / GH₵20
- Plus: 30 credits / GH₵50
- Pro: 75 credits / GH₵100
- Registration fee: GH₵50. Custom top-up: minimum GH₵5, conversion GH₵5 = 1 credit (rounded down). Every registration and credit-purchase request requires a payment proof screenshot (PNG/JPG/WEBP, up to 5 MB).
Default prices can be changed from the admin dashboard at `/admin` under Pricing controls; edits persist in PostgreSQL and apply immediately. Environment variables `REGISTRATION_FEE_GHS` and `CUSTOM_GHS_PER_CREDIT` are used only to seed the initial defaults for a fresh database. Every payment request requires a PNG/JPG/WEBP screenshot up to 5 MB. The admin dashboard displays proof images and handles registration and credit payments as separate approval types.

## Run locally
1. Install Node.js 20+ and PostgreSQL.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env` and configure all values.
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000`.

## Environment
`DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `MOMO_PAYEE_NAME`, `MOMO_NUMBER`, `MOMO_INSTRUCTIONS`, `REGISTRATION_FEE_GHS`, `CUSTOM_GHS_PER_CREDIT`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_SSL`, `PORT`, `NODE_ENV`.

The email in `ADMIN_EMAIL` becomes admin when registering. Proof screenshots are stored in PostgreSQL and shown in the admin payment queue. Registration and credit requests remain separately approved. Never expose API keys or ask customers for their MoMo PIN. Payment references are not proof by themselves; manually verify the transaction in your MoMo account before approving.

## Exact Render deployment steps (beginner-friendly)

1. **Download and extract** `FootballAI_Website.zip` on your computer. Keep the files inside the `FootballAI` folder together; do not upload the ZIP itself as your source code.
2. **Create a GitHub repository.** On GitHub, create a new repository named `footballai` (Private is fine). Upload the contents of the extracted `FootballAI` folder to the repository root, including `package.json`, `server.js`, `render.yaml`, and the `public` folder. Do not upload `.env` or API keys.
3. **Create PostgreSQL on Render.** In the Render dashboard choose **New + → PostgreSQL**. Name it `footballai-db`, select a region, create it, and copy its **Internal Database URL** if the web service is in the same region. Keep the database private.
4. **Create the web service.** Choose **New + → Web Service**, connect GitHub, select the `footballai` repository, and set:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance plan: choose a plan you want to use
5. **Add environment variables** in the Render web service under **Environment**. Add these exact keys and values:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = the Internal Database URL copied from your Render PostgreSQL database
   - `DATABASE_SSL` = `true` (if required by your database connection; this starter uses Render's typical SSL configuration)
   - `SESSION_SECRET` = a long, random secret; use Render's generate-secret option if offered
   - `ADMIN_EMAIL` = your own email address (you must register using this exact email to get admin access)
   - `OPENAI_API_KEY` = your OpenAI API key
   - `OPENAI_MODEL` = `gpt-4o-mini`
   - `REGISTRATION_FEE_GHS` = `50`
   - `CUSTOM_GHS_PER_CREDIT` = `5`
   - `MOMO_PAYEE_NAME` = `SUSANA WILLIAMS`
   - `MOMO_NUMBER` = `0506580144`
   - `MOMO_INSTRUCTIONS` = `Pay using the MTN Mobile Money details above, then upload a screenshot of the successful payment and enter the transaction reference. Never share your MoMo PIN.`
6. **Deploy.** Click **Create Web Service** or **Manual Deploy → Deploy latest commit**. Wait until Render reports the deploy is live. Open the service URL.
7. **Create your admin account.** Register on the deployed website with the exact email entered in `ADMIN_EMAIL` and a strong password of at least 10 characters. Open `/admin` on the same domain and sign in. If you registered before setting `ADMIN_EMAIL`, set the correct environment variable and redeploy; startup updates that matching account to admin.
8. **Test both approval queues.** Use a test account to submit the GH₵50 registration request with a proof screenshot and transaction reference. From `/admin`, verify the screenshot and approve the registration request. Only then test a credit purchase with its own screenshot and approve it separately. Credits must not be added until the credit payment is approved.
9. **Verify the upload.** In the admin payment queue, open “View proof-of-payment screenshot.” The app stores uploaded proof images in PostgreSQL and limits them to PNG/JPG/WEBP up to 5 MB. Manually verify the actual MoMo transaction before approving; screenshots can be forged.

### Important
- Do not publish your OpenAI key or `SESSION_SECRET` in GitHub, screenshots, or chats.
- Registration approval and credit-purchase approval are separate request types and separate admin actions.
- Fixed package prices are currently Starter (10 credits/GH₵20), Plus (30/GH₵50), Pro (75/GH₵100). Custom top-ups convert at GH₵5 per credit, rounded down. You can change these values directly in `/admin` → Pricing controls after signing in as the admin account. The settings are saved in PostgreSQL and are used immediately by both the customer website and analysis endpoint.
- This is a functional starter, not audited production software. Before public launch, add CSRF protection, email verification and password reset, privacy/terms/support pages, backups/monitoring, and a verified football-data API for live fixtures and statistics. Predictions are estimates, not guarantees.

## Before public launch
This is a functional starter, not a fully audited production service. Add CSRF protection, email verification and password reset, terms/privacy/support pages, backups/monitoring, and a verified football-data API for live fixtures and statistics. Current live match data is not included; the AI must not invent live stats.
