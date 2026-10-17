# Studio Lumina Photography SaaS — Current Business & Monetization Model

**Author:** Antigravity Autonomous SaaS Product Architect & FinTech Engineer  
**Document Version:** 1.0.0  
**Target Audience:** Engineering, Product, and Revenue Operations  

---

## 1. Business Model Evolution

Studio Lumina originated as a direct-to-cloud gallery and biometric search platform. Phase 44 introduces the **commercial SaaS billing engine**, enabling the platform to monetize through tiered monthly/annual subscriptions and modular storage capacity expansion.

### Core Monetization Principles:
1. **Server-Authoritative Truth:** All prices, quotas, plan capabilities, and payment statuses are calculated, verified, and enforced strictly by the backend. Frontend values are presentation-only.
2. **Predictable Cloud Margins:** Since Cloudflare R2 has $0.00 egress bandwidth fees, the primary marginal infrastructure cost is raw storage ($0.015/GB/mo) and database compute. Subscription tiers are priced with > 80% gross margins.
3. **No Ransomware Deletions:** If a subscription lapses or storage exceeds quota, client galleries remain accessible to guests for viewing. New uploads are paused until an upgrade or storage cleanup occurs.

---

## 2. Subscription Plan Architecture

The platform defines 4 standard database-driven subscription tiers:

| Plan Identifier | Name | Monthly Price (USD) | Annual Price (USD) | Storage Quota | Active Event Limit | AI Face Search | Video Support | Custom Branding |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `plan_free` | **Free Trial** | $0.00 | $0.00 | 5 GB | 2 Events | Limited (50 searches/mo) | No | Basic |
| `plan_starter` | **Starter** | $15.00 | $150.00 ($12.50/mo) | 25 GB | 10 Events | Standard (500 searches/mo) | Yes (1080p) | Yes |
| `plan_pro` | **Professional** | $39.00 | $390.00 ($32.50/mo) | 100 GB | 50 Events | Unlimited | Yes (4K) | Yes + Custom Watermark |
| `plan_studio` | **Studio Master**| $89.00 | $890.00 ($74.17/mo) | 500 GB | Unlimited | Unlimited | Yes (4K) | White-Label + Custom Domain |

### Financial Representation:
All monetary values are stored in **integer smallest currency units** (e.g., USD cents: `$39.00` is represented as `3900`). Floating-point money arithmetic is prohibited.

---

## 3. Storage Add-On Packages

Photographers on active paid plans who require additional capacity without advancing to higher tiers may purchase modular monthly storage add-ons:

| Add-On Identifier | Capacity Expansion | Monthly Price (USD) | Price in Cents |
| :--- | :---: | :---: | :---: |
| `addon_storage_50gb` | +50 GB | $5.00 / mo | 500 |
| `addon_storage_200gb` | +200 GB | $15.00 / mo | 1500 |
| `addon_storage_500gb` | +500 GB | $30.00 / mo | 3000 |
| `addon_storage_1tb` | +1,000 GB (1 TB) | $50.00 / mo | 5000 |

Total Effective Storage Quota:
$$\text{Total Storage Limit} = \text{Plan Storage Limit} + \sum (\text{Active Storage Add-Ons})$$

---

## 4. Storage Accounting & Quota Enforcement Rules

1. **Authoritative Calculation:**
   Storage usage is aggregated from verified physical R2 object sizes:
   $$\text{Used Bytes} = \text{Originals} + \text{Previews} + \text{Thumbnails} + \text{Videos} + \text{Posters}$$
2. **Recycle Bin Accounting Rule:**
   - **Decision:** Soft-deleted items in the Recycle Bin **continue to count toward storage quota**.
   - **Rationale:** Objects in the Recycle Bin reside physically in Cloudflare R2 and incur real infrastructure storage costs until permanently purged. The UI explicitly alerts users: *"Items in the Recycle Bin continue to consume storage quota until emptied or permanently deleted."*
3. **Pre-Upload Authorization Gate:**
   When a photographer initiates an upload (`POST /api/events/:id/media/presign-batch`), the API computes:
   $$\text{Used Bytes} + \text{Batch Size Requested} \le \text{Total Storage Limit}$$
   If the condition is violated, the API rejects the request with `HTTP 403 STORAGE_QUOTA_EXCEEDED` before any presigned URLs are issued.
4. **Over-Quota State Handling:**
   - Existing events, photos, videos, and guest face searches continue functioning uninterrupted.
   - New upload sessions are blocked.
   - The photographer dashboard highlights the account status as `OVER_QUOTA` and displays one-click storage upgrade prompts.

---

## 5. Subscription Lifecycle & Payment Handling

```
             +------------------+
             |    Registered    |
             +------------------+
                       |
                       v
             +------------------+
             | Free Trial (14d) |
             +------------------+
                       |
        +--------------+--------------+
        |                             | (Upgraded)
        v                             v
+------------------+         +------------------+
|   Trial Expired  |         |  Active Paid Plan|
+------------------+         +------------------+
                                      |
                       +--------------+--------------+
                       |                             | (Payment Fails)
                       v                             v
             +------------------+         +------------------+
             |    Cancelled     |         |     Past Due     |
             | (At Period End)  |         | (7-day Grace)    |
             +------------------+         +------------------+
```

1. **Webhook Security & Idempotency:**
   - Every inbound payment provider webhook must have its cryptographic signature verified.
   - Processed webhook event IDs are logged in `processed_webhook_events`. Duplicate events return `HTTP 200 OK` without triggering duplicate state mutations.
2. **Grace Period on Failed Renewals:**
   - If a renewal payment fails, the subscription enters `past_due` with a 7-day grace period.
   - Photographer receives immediate notification to update payment methods; uploads remain active during grace.
   - After 7 days without resolution, the subscription transitions to `unpaid` / `over_quota` upload restrictions.
3. **Cancellation Behavior:**
   - By default, cancellations take effect at the conclusion of the paid billing cycle (`cancel_at_period_end = true`). The photographer retains full paid entitlements until that date.
