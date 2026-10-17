/**
 * SaaS Business Engine, Subscriptions & Billing Types
 */

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'
  | 'expired';

export type BillingCycle = 'month' | 'year';

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  annual_price_cents: number;
  currency: string;
  billing_interval: string;
  storage_limit_bytes: number | string;
  event_limit: number;
  face_search_limit: number;
  video_enabled: boolean;
  custom_branding_enabled: boolean;
  features: string[];
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface Subscription {
  id: string;
  photographer_id: number;
  plan_id: string;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_start: string | Date;
  current_period_end: string | Date;
  cancel_at_period_end: boolean;
  cancelled_at: string | Date | null;
  grace_period_until: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface StorageAddon {
  id: string;
  name: string;
  capacity_bytes: number | string;
  price_cents: number;
  currency: string;
  is_active: boolean;
  created_at: string | Date;
}

export interface PhotographerStorageAddon {
  id: string;
  photographer_id: number;
  addon_id: string;
  status: string;
  provider_subscription_id: string | null;
  current_period_end: string | Date;
  created_at: string | Date;
  name?: string;
  capacity_bytes?: number | string;
  price_cents?: number;
}

export interface Invoice {
  id: string;
  photographer_id: number;
  subscription_id: string | null;
  provider_invoice_id: string | null;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  description: string | null;
  invoice_pdf_url: string | null;
  issued_at: string | Date;
  paid_at: string | Date | null;
  created_at: string | Date;
}

export interface StorageQuotaStatus {
  usedBytes: number;
  planStorageLimitBytes: number;
  addonStorageBytes: number;
  totalStorageLimitBytes: number;
  remainingBytes: number;
  percentageUsed: number;
  isOverQuota: boolean;
  warningLevel: 'normal' | 'warning' | 'critical' | 'exceeded';
  activeEventsCount: number;
  eventLimit: number;
  canUpload: boolean;
}

export interface SubscriptionOverviewDTO {
  plan: Plan;
  subscription: Subscription;
  addons: PhotographerStorageAddon[];
  quota: StorageQuotaStatus;
  invoices: Invoice[];
}

export interface CreateCheckoutSessionRequest {
  planId?: string;
  addonId?: string;
  billingCycle?: BillingCycle;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateCheckoutSessionResponse {
  sessionId: string;
  checkoutUrl: string;
  mode: 'subscription' | 'addon';
}
