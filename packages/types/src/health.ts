/**
 * Health Check and Diagnostic Contract Types
 */

export type SubsystemStatus = 'healthy' | 'degraded' | 'unhealthy' | 'disabled';

export interface SubsystemHealthCheck {
  status: SubsystemStatus;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  uptimeSeconds: number;
  environment: string;
  checks: {
    database: SubsystemHealthCheck;
    redis: SubsystemHealthCheck;
    aiService: SubsystemHealthCheck;
    storage?: SubsystemHealthCheck;
    queues?: SubsystemHealthCheck;
  };
}

export interface ProbeResponse {
  status: 'ok';
  timestamp: string;
  service: string;
}
