# 🧵 Cloth Shop Billing & Inventory App (Local-First)

### 📘 Detailed README & Technical Specification

---

# 🚀 1. Project Overview

This application is a **local-first mobile app** designed for cloth shop owners to manage:

* 🧾 Billing & invoice generation
* 📦 Inventory with size-based tracking
* 📷 QR/Barcode generation & scanning
* 👤 Customer data
* 📊 Sales tracking

👉 The app **stores all data locally (offline)** using SQLite.
👉 Cloud sync and multi-device support are optional: when Supabase is configured, the catalogue, stock movements, customers and bills are replicated in the background while SQLite remains the source of truth.

---

# 🎯 2. Key Requirements

## ✔ Functional Requirements

### 🧾 Billing

* Create invoice
* Add products via:

  * Manual selection
  * Barcode/QR scan
* Apply:

  * Discount (flat / %)
  * Tax (GST optional)
* Generate bill (print-ready)
* Save transaction locally

---

### 📦 Inventory

* Add/Edit/Delete products
* Mandatory **Product Type (Category)** while adding product
* Track stock:

  * Size-wise (S, M, L, XL, etc.)
  * Quantity
* Low stock alert

---

### 📷 QR / Barcode

* Generate barcode for each product
* Scan barcode to:

  * Fetch product
  * Add to billing

---

### 👤 Customers

* Add customer details
* Track purchase history
* Optional: due/payment tracking

---

### 📊 Reports

* Daily sales
* Monthly sales
* Top-selling products

---

## ❌ Non-Functional Requirements

* Works **100% offline**
* Fast response (<1 sec for operations)
* Simple UI (shop-friendly)
* Lightweight (low storage usage)

---

# 🧱 3. Tech Stack

## 📱 Frontend

* React Native (Expo)
* TypeScript (recommended)

## 🗄️ Local Database

* SQLite (via `expo-sqlite`)

## 📷 QR/Barcode

* Scanner: `expo-barcode-scanner`
* Generator: `react-native-qrcode-svg`

## 🖨️ Printing (Future Phase)

* Bluetooth thermal printer

---

# 🏗️ 4. Application Architecture

```
App (React Native)
   ↓
Service Layer (Business Logic)
   ↓
SQLite Database
   ↓
(Local Storage)
```

### Layers:

### 1. UI Layer

* Screens
* Components

### 2. Service Layer

* Billing logic
* Inventory updates
* Calculations

### 3. Data Layer

* SQLite queries
* CRUD operations

---

# 🗂️ 5. Folder Structure

```
/src
 ├── components/
 ├── screens/
 │    ├── Billing/
 │    ├── Inventory/
 │    ├── Customers/
 │    ├── Reports/
 │
 ├── database/
 │    ├── db.ts
 │    ├── schema.ts
 │    ├── queries/
 │
 ├── services/
 │    ├── billingService.ts
 │    ├── inventoryService.ts
 │
 ├── utils/
 │    ├── barcode.ts
 │    ├── calculations.ts
 │
 ├── types/
 │    ├── models.ts
 │
 └── constants/
```

---

# 🧾 6. Database Schema (IMPORTANT)

## 🟢 1. Product Types (MANDATORY)

```
product_types
--------------
id (PK)
name (UNIQUE)
created_at
```

👉 Examples:

* Shirt
* Jeans
* T-Shirt
* Saree

---

## 🟢 2. Products

```
products
--------------
id (PK)
name
type_id (FK → product_types)
price
barcode (UNIQUE)
created_at
```

---

## 🟢 3. Inventory (Size-based)

```
inventory
--------------
id (PK)
product_id (FK)
size (TEXT)
quantity (INTEGER)
```

👉 Example:

| product_id | size | qty |
| ---------- | ---- | --- |
| 1          | M    | 10  |
| 1          | L    | 5   |

---

## 🟢 4. Customers

```
customers
--------------
id (PK)
name
phone
total_purchase
due_amount
created_at
```

---

## 🟢 5. Orders (Invoices)

```
orders
--------------
id (PK)
date
customer_id (FK)
total_amount
discount
tax
final_amount
payment_mode
```

---

## 🟢 6. Order Items

```
order_items
--------------
id (PK)
order_id (FK)
product_id (FK)
size
quantity
price
```

---

# 🧠 7. Data Models (TypeScript)

```ts
export interface Product {
  id: number;
  name: string;
  typeId: number;
  price: number;
  barcode: string;
}

export interface Inventory {
  productId: number;
  size: string;
  quantity: number;
}

export interface Order {
  id: number;
  date: string;
  totalAmount: number;
  discount: number;
  tax: number;
  finalAmount: number;
}

export interface OrderItem {
  productId: number;
  size: string;
  quantity: number;
  price: number;
}
```

---

# 🔁 8. Core Workflows

## 🧾 Billing Flow

1. Scan barcode / select product
2. Choose size
3. Add quantity
4. Apply discount
5. Calculate total
6. Save order
7. Reduce inventory

---

## 📦 Inventory Flow

1. Add product (with type REQUIRED)
2. Add sizes & quantity
3. Update stock after each sale

---

## 📷 Scan Flow

1. Open scanner
2. Scan barcode
3. Fetch product from DB
4. Add to cart

---

# ⚙️ 9. Business Logic

## 💰 Price Calculation

```ts
finalAmount = totalAmount - discount + tax;
```

---

## 📉 Inventory Update

```ts
newQty = currentQty - soldQty;
```

---

# 🖥️ 10. Screens (UI)

### 1. Dashboard

* Sales summary
* Quick actions

### 2. Billing Screen

* Product list / scan
* Cart view
* Total calculation

### 3. Inventory Screen

* Product list
* Add/Edit product

### 4. Add Product Screen

* Name
* Type (dropdown REQUIRED)
* Price
* Sizes + quantity

### 5. Customer Screen

### 6. Reports Screen

---

# 🔒 11. Validations

* Product must have:

  * Name
  * Type
  * Price
* Barcode must be unique
* Quantity cannot be negative

---

# 🧪 12. Testing Strategy

* Unit test:

  * Billing calculation
  * Inventory update
* Manual test:

  * Scan → Add → Bill
  * Stock deduction

---

# ⚡ 13. Performance Considerations

* Use indexed queries in SQLite
* Cache product list in memory
* Avoid heavy joins

---

# 🔄 14. Future Enhancements

* ☁️ Cloud sync for catalogue, inventory, customers and bills
* 📱 Append-only stock movement sync with per-device deltas
* 🖨️ Thermal printer integration
* 📤 WhatsApp bill sharing
* 📊 Advanced analytics

---

# ⚠️ 15. Important Notes

* Always use **Product Type** as mandatory (business critical)
* Design DB flexible for future sync
* Keep IDs consistent (UUID preferred later)

---

# 🧠 16. AI Product Import (Gemini)

This feature scans **purchase invoices** or an individual **garment label / price tag** and turns the result into editable product drafts. It is additive: existing billing, inventory, labels, printing and reports are untouched.

### What it does

* **Purchase invoice scan** — extracts every product line (name, brand, purchase cost, quantity, size, colour, MRP, barcode) plus supplier name and invoice number where visible.
* **Product label scan** — extracts the available details from one label/tag and creates a single draft.
* **Structured JSON** — Gemini returns a schema-constrained response. The app validates and normalises it; missing values stay `null` and are never invented.
* **Review before write** — drafts are editable in a dedicated screen. Product type is mandatory and must be selected from existing `product_types`.
* **Duplicate detection** — a matching barcode or product name is flagged. Barcode matches can only add stock to the existing product; name matches can be linked or overridden.
* **Inventory safety** — extraction never creates products or changes stock. Creating a product, receiving stock, or confirming all drafts are separate explicit actions.
* **Size-wise stock entry** — the review screen uses the same size-group grid as Add Product. Each size can have its own quantity; confirming adds every size to inventory and prints one label per size/unit.
* **Print labels after confirming** — each confirmed draft offers **Print Label** (or a label count for multi-piece receipts); the existing thermal/system label pipeline is reused, and "Confirm All" can print every confirmed label at once.
* **Local history** — extraction sessions and drafts are stored in the existing SQLite database (`ai_import_sessions`, `ai_product_drafts`). Cloud sync is optional; without it, everything stays on the device.

### Files added

```
app/ai-import.tsx                 Capture / upload + recent imports
app/ai-import-review.tsx          Editable draft review + confirmations
src/ai/config.ts                  Proxy URL / timeout configuration
src/ai/parse.ts                   Structured-output parsing and validation
src/ai/drafts.ts                  Type matching, duplicate detection, validation
src/ai/sizes.ts                   Size-wise draft quantities and validation
src/components/SizeQuantityEditor.tsx  Shared Add Product / AI review size grid
src/ai/errors.ts                  Typed AI / draft errors
src/ai/__tests__/                 Unit tests
src/services/imageService.ts      Resize / convert images to JPEG
src/services/geminiService.ts     Mobile -> proxy client
src/services/aiImportService.ts   Extraction + explicit product/stock confirmation
src/database/queries/aiImportQueries.ts
server/gemini-proxy.mjs           Dependency-free Gemini API proxy
.env.example                      Environment template
```

The dashboard and Inventory header both link to **AI Import**.

### Setup

1. **Create an environment file**

   ```bash
   copy .env.example .env
   ```

2. **Start the proxy** (Node 18+)

   ```powershell
   $env:GEMINI_API_KEY="your-google-ai-studio-key"
   npm run ai-proxy
   ```

   The proxy also reads `GEMINI_API_KEY` from the root `.env`, so you can set it there instead. Optional proxy variables: `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL` (`off`/`minimal`/`low`/`medium`/`high`, default `low`), `PROXY_SHARED_SECRET`, `PORT`, `RATE_LIMIT_PER_MINUTE`, `ALLOWED_ORIGIN`. See `.env.example`.

3. **Point the app at the proxy**

   ```env
   EXPO_PUBLIC_AI_PROXY_URL=http://localhost:8787
   ```

   * Android emulator: use `http://10.0.2.2:8787`.
   * Physical phone: use the computer's LAN IP, e.g. `http://192.168.1.10:8787`.
   * Restart Expo after changing `.env` (`npx expo start -c`).

4. **Optional shared secret**

   Set the same value on both sides:

   ```env
   # proxy
   PROXY_SHARED_SECRET=long-random-string
   # app
   EXPO_PUBLIC_AI_PROXY_TOKEN=long-random-string
   ```

5. **Run the checks**

   ```bash
   npm test
   npm run typecheck
   ```

### Troubleshooting "AI import is not configured"

1. Check the proxy: `curl http://localhost:8787/health` must return `"configured": true`. If it returns `false`, the proxy did not see `GEMINI_API_KEY`; set it in the root `.env` and restart `npm run ai-proxy`.
2. The mobile app reads `.env`, **not** `.env.example`. Create `.env` (`copy .env.example .env`) and set `EXPO_PUBLIC_AI_PROXY_URL`.
3. Restart Expo with `npx expo start -c`. `EXPO_PUBLIC_*` values are inlined into the bundle, so a normal reload does not pick up `.env` changes.
4. If Gemini reports that the selected model is no longer available, set `GEMINI_MODEL=gemini-3.5-flash` (the default) and restart the proxy.

### Security model

* The Gemini API key is **only** read by `server/gemini-proxy.mjs`. It is never referenced by the Expo app and never appears in the production bundle.
* `EXPO_PUBLIC_*` values are public by definition. Never put `GEMINI_API_KEY` behind an `EXPO_PUBLIC_` name.
* The proxy has an optional bearer token, per-IP rate limiting, request-size limits and image MIME validation.
* For production, put the proxy behind HTTPS, add real user authentication, restrict CORS and keep the rate limiter at the edge/reverse proxy. The included proxy is intentionally minimal and dependency-free.
* Base64 image data is never logged.

### Database migration

New tables are created automatically by `CREATE_TABLES_SQL` on startup:

* `ai_import_sessions` — mode, status, supplier/invoice, image quality, warnings, raw response, error details.
* `ai_product_drafts` — editable extracted fields, size-wise quantities (`sizes_json`), matched type, status (`pending`, `created`, `stock_added`, `discarded`), linked product id.

`products` gains nullable `brand` and `colour` columns for values captured during import. The existing in-place migration in `src/database/db.ts` adds them to older installations; existing rows and screens continue to work. Older drafts are opened with their single size/quantity pre-filled in the new size grid.

### Error handling

* Offline / unreachable proxy: friendly retry prompt.
* Timeout / Gemini 429 / 5xx: retryable message.
* Invalid or unparseable JSON: saved as a failed import in history.
* Missing fields: left `null`; confirmation blocks only the fields required by the existing product rules (name, existing type, selling price, and size/quantity when receiving stock).
* Blurry/unreadable images: warnings from the model are shown; no products produces a clear retake message.
* Duplicate barcode: product creation is blocked and stock must be added to the existing product.

### Architecture note

The proxy receives `POST /api/ai/extract` with:

```json
{
  "mode": "invoice",
  "image": { "mimeType": "image/jpeg", "data": "<base64>" }
}
```

and returns `{ "data": <validated model JSON>, "model": "...", "usage": {...} }`. The mobile app independently validates every field before writing drafts, so a malformed proxy/model response cannot create products.

---

# ☁️ 17. Cloud Sync (Supabase, optional)

The app remains **local-first**. SQLite is still the source of truth for every screen; cloud sync is a background replica used for backup, a second device and the hosted AI function. If `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are blank, the app behaves exactly as before.

### What is included

```
supabase/migrations/20261029000000_cloud_sync.sql   Shops, RLS, catalogue replica, change log, RPCs
supabase/migrations/20261029001000_sync_operational_tables.sql  Customers, bills, bill lines, stock movements
supabase/functions/ai-extract/                     Gemini Edge Function (replaces the local proxy when signed in)
supabase/functions/_shared/gemini.ts               Prompt + schema + Gemini client
src/sync/client.ts                                 Supabase client (auth session in AsyncStorage)
src/sync/activeShop.ts                             Active shop + per-shop local database selection
src/sync/engine.ts                                 Outbox push / change-log pull
src/database/syncSchema.ts                         Local outbox, sync state, SQLite triggers
app/cloud-sync.tsx                                 Sign in, create/join shop, sync, invite code
```

### Sync scope

* Synced: `product_types`, `products`, `customers`, `orders`, `order_items` and `stock_movements` (create, edit, soft delete where applicable).
* Stock is replicated as **append-only deltas**, not absolute quantities. Each stock receipt, sale and manual adjustment records one movement, so two devices cannot silently overwrite each other's counts.
* Inventory remains a fast local cache. On pull, the app applies each new movement to the cached quantity and recalculates customer totals from the local bill ledger.
* A one-time baseline movement captures stock that existed before operational sync. It uses a deterministic id and `1970-01-01` timestamp, so backing up or joining cannot double-count post-update movements.
* Physical-presence billing means no online stock reservation is required. Cashiers still bill only physically present stock.
* The first linked shop reuses the existing `billingapp.db`, preserving existing data. Additional shops get isolated local database files (`billingapp-<shop-id>.db`).
* Joining a shop in **pull** mode leaves pre-existing local bills/stock on the device and marks the one-time upload as complete, so they are not pushed into the joined shop. **Upload** mode snapshots the local catalogue, customers, bills and current stock baseline.
* The app attempts a best-effort sync after startup and whenever it returns to the foreground. **Sync Now** forces an immediate sync; failed background attempts are shown on the Cloud Sync screen.

### Deploy

1. Create a free project at [supabase.com](https://supabase.com).
2. Link and push the migration:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Alternatively paste both migration files into the dashboard SQL editor, in filename order (`20261029000000_cloud_sync.sql`, then `20261029001000_sync_operational_tables.sql`).

3. Set Edge Function secrets (the **Gemini key never goes into the mobile bundle**):

   ```bash
   npx supabase secrets set GEMINI_API_KEY=your-google-ai-studio-key
   npx supabase secrets set GEMINI_MODEL=gemini-3.5-flash
   npx supabase secrets set GEMINI_THINKING_LEVEL=low
   npx supabase secrets set AI_DAILY_LIMIT=30
   ```

4. Deploy the AI function:

   ```bash
   npx supabase functions deploy ai-extract
   ```

5. Add the public project values to `.env`:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
   ```

6. Restart Expo with `npx expo start -c`, open **Cloud Sync** from the dashboard, create an account, then create or join a shop.

For quick testing, disable **Confirm email** in Supabase Authentication settings. With it enabled, the user must confirm the email before signing in.

### Security model

* Every synced table has Row Level Security; access is limited to rows whose `shop_id` is in the caller's `shop_members`.
* `create_shop` / `join_shop` / `sync_push` / `consume_ai_quota` are `security definer` RPCs that check `auth.uid()` and shop membership. `sync_pull` additionally checks membership itself and also runs under the caller's `change_log` RLS policy.
* Product type names are unique on each device but not on the server. If two devices created the same name with different ids, the puller merges the duplicate type by name and routes its products to the existing local type.
* The anon key is safe in the app; the Gemini key and service-role key are server-only.
* The Edge Function verifies the user JWT and enforces a per-user/per-shop daily AI quota (`AI_DAILY_LIMIT`, default 30). No image is stored in Supabase Storage.
* Base64 image data and secrets are never logged.

### Free-tier notes

Supabase free currently includes a 500 MB database, 1 GB storage, 5 GB egress, 500k Edge Function calls/month and 2 projects. Projects can pause after about a week of inactivity. If Edge Function limits become a problem, the same function can move to Cloudflare Workers + D1 + R2; the mobile API shape stays the same.

### Troubleshooting

* **"Cloud sync is not configured"** — both `EXPO_PUBLIC_SUPABASE_*` values must be present and Expo restarted with `-c`.
* **Sign-up succeeds but no session** — email confirmation is enabled; confirm the email or disable it in the Supabase dashboard.
* **`not a shop member`** — the user has not created/joined the active shop, or `shop_members` RLS has no row for that account.
* **AI falls back to the local proxy** — cloud AI is used only when Supabase is configured, the user is signed in and a shop is active. Otherwise the existing `EXPO_PUBLIC_AI_PROXY_URL` path is used.
* **Two products share a barcode** — the server keeps the first barcode and stores the later product without a barcode. The next pull clears the duplicate locally, so sync continues. Re-assign a barcode on one product if needed.
* **Two customers share a phone number** — this is allowed; the server uses a non-unique lookup index, so offline customer creation never blocks a push.
* **Stock looks wrong after joining** — pull mode does not upload local bills/stock. Use upload mode for a device whose existing stock should become the shop's starting stock.

---

# 🏁 Conclusion

This app is:

* 💡 Highly practical
* 💰 Monetizable
* 🚀 Scalable (offline → cloud)

---
