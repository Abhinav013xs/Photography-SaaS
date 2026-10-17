# Studio Lumina Photography SaaS — Admin Permission & Role Matrix

**Document Classification:** Internal Security & Platform Operations Standard  
**Document Version:** 1.0.0  
**Phase:** 45 (Admin Operations, Customer Support, Audit System, Platform Control Center & Incident Management)  
**Governing Principle:** Zero God Mode / Principle of Least Privilege (PoLP)  

---

## 1. Core Architectural Principle: No God Mode

Administrative access in Studio Lumina is engineered around a strict boundary:

> **ADMIN ACCESS DOES NOT MEAN: "Admin can see everything."**  
> **ADMIN ACCESS = ONLY THE MINIMUM PRIVILEGE REQUIRED TO PERFORM A SPECIFIC OPERATIONAL TASK.**

Under no circumstances do internal operational personnel gain casual, unlogged, or unrestricted visibility into:
1. **Raw biometric face embeddings** (128-D vector arrays).
2. **Ephemeral guest selfies** (processed strictly in RAM, zero storage retention).
3. **Private photos and 4K videos** of customers and their guests.
4. **Photographer credentials** (passwords, salted bcrypt hashes, session tokens).
5. **Customer payment card details** (managed strictly by payment gateway tokens).

---

## 2. Administrative Role Definitions

The platform defines six explicit operational roles:

| Role Identifier | Role Name | Intended Operator | Operational Responsibility |
| :--- | :--- | :--- | :--- |
| `SUPER_ADMIN` | **Super Administrator** | Platform Owner & Engineering Leads | Full system control, break-glass oversight, configuration switches, admin account lifecycle. |
| `PLATFORM_ADMIN` | **Platform Operations Admin** | Senior Operations & SRE | Infrastructure reliability, user account suspension/restoration, storage reconciliation, worker queue operations. |
| `OPERATIONS_AGENT` | **Operations Agent** | Reliability & Support Engineers | Job retries, dead-letter queue (DLQ) triage, subsystem telemetry, storage audits. |
| `SUPPORT_AGENT` | **Customer Support Agent** | Customer Operations & Support Tier 2 | User metadata lookup, event diagnostics, support tickets, time-boxed break-glass event access. |
| `FINANCE_ADMIN` | **Finance & Revenue Admin** | Billing Operations & Accounting | Subscription reviews, plan adjustments, storage capacity add-on grants, credit issuance. |
| `READ_ONLY_ADMIN` | **Auditor & Compliance Inspector**| Security Auditor / Executive | Read-only telemetry, immutable audit log verification, compliance inspection. |

---

## 3. Explicit Administrative Permission Matrix

| Capability / API Scope | `SUPER_ADMIN` | `PLATFORM_ADMIN` | `OPERATIONS_AGENT` | `SUPPORT_AGENT` | `FINANCE_ADMIN` | `READ_ONLY_ADMIN` | Mandatory Audit Log Trigger |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **View Telemetry & Subsystem Health** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | None (Read-only) |
| **Search & View Photographers** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | None (Read-only) |
| **Suspend Photographer Account** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | `USER_SUSPENDED` (Reason required) |
| **Restore Suspended Account** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | `USER_RESTORED` (Reason required) |
| **View Event Metadata (Count only)** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | None (Read-only) |
| **Inspect Event Processing Breakdown**| ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | None (Read-only) |
| **Time-Boxed Break-Glass Gallery** | ✅ | ❌ | ❌ | ✅ (15m TTL) | ❌ | ❌ | `BREAK_GLASS_EVENT_ACCESSED` (Mandatory justification) |
| **Monitor Queue & Processing Jobs** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | None (Read-only) |
| **Retry Failed Job (Bounded Safe Retry)**| ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | `JOB_RETRIED` |
| **Cancel Stuck / Poison Queue Job** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `JOB_CANCELLED` |
| **Inspect Storage Distribution** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | None (Read-only) |
| **Run Storage Reconciliation Engine** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `STORAGE_RECONCILIATION_RUN` |
| **Inspect Billing & Revenue Summary** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | None (Read-only) |
| **Manual Billing / Storage Add-On Override**| ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | `BILLING_ADJUSTMENT` (Reason required) |
| **Manage Customer Support Tickets** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | `SUPPORT_TICKET_UPDATED` |
| **Declare Platform Incident (SEV-1..4)**| ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `INCIDENT_OPENED` |
| **Resolve Platform Incident** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | `INCIDENT_UPDATED` |
| **Toggle Emergency Kill Switches** | ✅ | ✅ (Typed confirmation) | ❌ | ❌ | ❌ | ❌ | `FEATURE_FLAG_TOGGLED` |
| **View Immutable Audit Logs** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | None (Read-only) |
| **Manage Admin User Roles** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | `ADMIN_ROLE_MODIFIED` |

---

## 4. Biometric Data Confidentiality Rules

1. **Zero Raw Embeddings:** Neither the admin dashboard nor any `/api/admin/*` endpoint shall ever serialize or render 128-dimensional floating-point vectors (`face_embeddings.embedding`). The interface strictly returns aggregate counts: e.g. `4,832 faces indexed`.
2. **Zero Guest Selfie Persistence:** Guest selfies submitted for "Find My Photos" exist solely in RAM buffers during cosine distance search and are destroyed in a `finally` block before response delivery. Admins cannot view or download query selfies.
3. **No Cross-Event Vector Lookups:** Admin diagnostics for face recognition are event-partitioned (`WHERE event_id = ?`).

---

## 5. Dangerous Action Safeguards

To prevent operational accidents:
1. **Account Suspension:** Requires explicit operator reason (minimum 5 characters).
2. **Emergency Kill Switches (`face_search`, `maintenance_mode`):** Requires typed verification string `"CONFIRM"` before the state change is accepted by the server.
3. **Storage Discrepancies:** Automated reconciliation runs produce an audit report only. Automatic purges of unexpected objects require manual SRE confirmation.
4. **Break-Glass Ephemeral Access:** Issues an ephemeral 15-minute token requiring an explicit justification statement (minimum 10 characters). The action is immutably recorded in `admin_audit_logs`.
