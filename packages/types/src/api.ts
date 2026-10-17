/**
 * Standard API Envelope Contracts
 * Strictly following docs/API.md and Phase 1 specifications.
 */

export interface ApiSuccessMeta {
  requestId: string;
  total?: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ApiSuccessMeta;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[] | unknown;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
