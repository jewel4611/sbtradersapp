# M/S SB Traders — Stock, Sales & Ledger App

A React + Firestore app for stock management, sales with auto-generated
invoice/challan, and client ledger with dues tracking — with real,
per-role login enforced by Firestore itself.

## 1. Create a free Firebase project

1. Go to https://console.firebase.google.com and click **Add project**.
   Name it e.g. `sb-traders`. Google Analytics is not needed.
2. **Build → Firestore Database → Create database.** Choose **Production
   mode**, pick a region close to Bangladesh (e.g. `asia-south1`).
3. **Build → Authentication → Get started** → enable the **Email/Password**
   provider (Sign-in method tab). Every staff PIN becomes a real password
   under the hood, so this is the only provider you need.
   (If Anonymous sign-in is enabled from an earlier version of this app,
   turn it **off** here — it's no longer used and leaving it on would
   reopen a loophole the new rules are designed to close.)
4. **Project settings** (gear icon) → **Your apps** → click the **Web**
   icon (`</>`) → register an app (any nickname) → copy the
   `firebaseConfig` values shown.
5. In Firestore, open the **Rules** tab, paste in the contents of
   `firestore.rules` from this project, and **Publish**.

## 2. Configure this project

1. Copy `.env.example` to `.env` and fill in the six
   `VITE_FIREBASE_...` values from step 4 above.
2. Install dependencies and run locally to test:
   ```
   npm install
   npm run dev
   ```
3. Open the local URL — you'll see the "Welcome to M/S SB TRADERS" setup
   screen (only shown once, before any accounts exist). Create the Jewel
   (Admin) and Bahar (Manager) accounts, each with a **6-digit PIN**.

## 3. Deploy to Netlify

**Recommended — connect your Git repo** (so environment variables work):
1. Push this project to a GitHub/GitLab repo.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
   Build command `npm run build`, publish directory `dist` (already set
   in `netlify.toml`, Netlify should detect it automatically).
3. **Site settings → Environment variables** → add the same six
   `VITE_FIREBASE_...` keys from your `.env`.
4. Deploy. Every push auto-redeploys.

**Quick option — drag and drop:** run `npm run build` locally, then drag
the resulting `dist/` folder onto https://app.netlify.com/drop. You'll
still need to set the environment variables in Site settings afterwards
and trigger a rebuild, since a plain drag-and-drop deploy skips the build
step where they'd normally get baked in.

## How the login actually works now

Every person's PIN is a **real Firebase Authentication password** —
Firebase itself verifies it, nothing in Firestore ever stores it. Under
the hood, a staff member named "Karim" with username `karim` signs in as
`karim@staff.sbtraders.app` / their PIN. That email is never sent
anywhere; it's just a unique ID Firebase Auth requires.

Each person also has a small **profile document** in Firestore
(`users/{their-id}`) holding only their name, role, which sections
they're allowed into, and whether they're active — never a password.
**Firestore's security rules read that profile on every request** and
allow or deny the read/write accordingly. This means:

- A "Staff" login that only has the New Sale tab genuinely **cannot**
  read or write client ledgers or edit stock prices — Firestore itself
  refuses it, not just the app's UI hiding the button.
- Only Admin can create, edit, deactivate, or delete staff accounts.
- Removing or deactivating someone's profile locks them out on their
  very next request, even if they're mid-session.

**Known limitation:** creating a brand-new staff login and resetting an
existing PIN both need the standard Firebase Admin SDK to do cleanly,
which normally means a backend server. Since this app is 100% static
(no backend, deployed straight to Netlify), account **creation** is done
with a client-side workaround (a hidden second sign-in used only for the
instant it takes to register the new login), but PIN **resets** aren't
possible for anyone but the account holder — Admin cannot reset another
person's PIN from the Staff Accounts page. If someone forgets their PIN,
Admin can deactivate their old account and create a fresh one for them
(their sales/ledger history stays intact either way, since it's tied to
client and product records, not to the staff account). Everyone can
change their own PIN anytime from the "Change PIN" icon next to their
name.

## What's stored where

- **Firestore collections**: `products`, `clients`, `invoices`,
  `payments`, `users` (full staff profiles, admin-only to browse),
  `directory` (public, name + role + active flag only — powers the login
  picker before anyone signs in), and `settings` (the shared digital
  signature + seal images). Plus `meta/counters` for invoice numbering
  and `meta/setupComplete` marking first-run setup as done.
- All data syncs in real time across every device your staff use.
- Selling stock runs as a single Firestore **transaction**, so two people
  selling the last units of the same item at the same moment can't both
  succeed — the second is told there isn't enough stock left.

## Invoices vs Challans

Every sale generates one record, but it prints as two separate documents:

- **Invoice** — full pricing, subtotal, discount, paid, due.
- **Challan** — product names, quantities, delivery address and date only.
  No prices anywhere on it.

Both carry a "Receiver's Signature" line and an "Authorized Signature"
area. Upload a signature and/or seal image once from **Settings**
(Admin or Manager only) and both documents pick it up automatically from
then on — no need to re-upload per invoice.

## Editing invoices and clients

Admin and Manager can edit any invoice from the Invoices list or from a
client's ledger. Changing item quantities, prices, or the client
re-runs stock as a single transaction: it puts the *original* quantities
back into stock, then takes out the *new* quantities, so stock is never
double-counted. If an invoice has an item from before this feature
existed (no linked product), that one line is flagged and won't
auto-adjust stock — everything else on the same invoice still will.

Client name, phone, address, and **opening balance** (what a client
already owed — or a credit they already had — before you started using
this app) are all editable from the client's ledger page.

## Payments

Recording a payment now captures a method (Cash, bKash, Nagad, Rocket,
Bank Transfer, Cheque, Other) and an optional reference/transaction ID
alongside the amount. A client's ledger page shows **Total Invoiced**,
**Total Paid**, and **Current Due** as three summary cards, so tracking
someone who pays in two or three installments no longer means adding up
individual invoices by hand.
