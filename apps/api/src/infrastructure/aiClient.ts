import { getConfig } from '@photography-saas/config';
import type {
  SubsystemHealthCheck,
  FaceDetectionResponseDTO,
  FaceEmbeddingResponseDTO,
  ProcessQuerySelfieResponseDTO,
} from '@photography-saas/types';
import {
  NoFaceDetectedError,
  MultipleFacesDetectedError,
  InvalidSelfieError,
} from '@photography-saas/errors';
import { logger } from '../utils/logger.js';


/**
 * Constructs internal service authentication headers.
 */
export function getInternalHeaders(): Record<string, string> {
  const config = getConfig();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const key = config.aiService.internalKey || config.internalServiceKey || config.authSecret;
  if (key) {
    headers['X-Internal-Service-Key'] = key;
  }
  return headers;
}

/**
 * Checks connectivity to the dedicated Python AI Microservice.
 * Probes the /health endpoint without executing any fake biometric processing.
 */
export async function checkAiServiceHealth(): Promise<SubsystemHealthCheck> {
  const config = getConfig();
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.aiService.timeoutMs);

  try {
    const healthUrl = `${config.aiService.url}/health`;
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: getInternalHeaders(),
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        status: 'healthy',
        latencyMs,
        details: data,
      };
    }

    return {
      status: 'degraded',
      latencyMs,
      message: `AI service returned HTTP ${response.status}`,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : 'AI service unreachable';
    return {
      status: 'unhealthy',
      latencyMs,
      message,
    };
  }
}

/**
 * Checks readiness of the dedicated Python AI Microservice (/ready endpoint).
 * Verifies that neural models (YuNet + SFace) are pre-warmed in memory.
 */
export async function checkAiServiceReady(): Promise<SubsystemHealthCheck> {
  const config = getConfig();
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.aiService.timeoutMs);

  try {
    const readyUrl = `${config.aiService.url}/ready`;
    const response = await fetch(readyUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: getInternalHeaders(),
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        status: 'healthy',
        latencyMs,
        details: data,
      };
    }

    return {
      status: 'degraded',
      latencyMs,
      message: `AI service returned HTTP ${response.status} on /ready`,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : 'AI service unreachable';
    return {
      status: 'unhealthy',
      latencyMs,
      message,
    };
  }
}

/**
 * Calls Python AI service to detect faces in an image using OpenCV YuNet.
 * Returns normalized bounding boxes and landmark coordinates.
 */
export async function detectFacesInImage(
  imageBuffer: Buffer,
  confidence?: number
): Promise<FaceDetectionResponseDTO> {
  const config = getConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.aiService.timeoutMs * 2);

  const url = new URL(`${config.aiService.url}/detect-faces`);
  if (confidence !== undefined) {
    url.searchParams.set('confidence', String(confidence));
  }

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' });
  formData.append('file', blob, 'image.jpg');

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: getInternalHeaders(),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { detail?: string };
      const errorMessage = errorBody.detail || `AI service returned HTTP ${response.status}`;
      throw new Error(`Face detection failed: ${errorMessage}`);
    }

    const data = (await response.json()) as FaceDetectionResponseDTO;
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    logger.warn('Error during face detection AI service call', {
      service: 'ai-client',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Calls Python AI service to detect faces and extract 128-D L2-normalized vectors using OpenCV SFace.
 */
export async function extractFaceEmbeddings(
  imageBuffer: Buffer,
  confidence?: number
): Promise<FaceEmbeddingResponseDTO> {
  const config = getConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.aiService.timeoutMs * 3);

  const url = new URL(`${config.aiService.url}/extract-embeddings`);
  if (confidence !== undefined) {
    url.searchParams.set('confidence', String(confidence));
  }

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' });
  formData.append('file', blob, 'image.jpg');

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: getInternalHeaders(),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { detail?: string };
      const errorMessage = errorBody.detail || `AI service returned HTTP ${response.status}`;
      throw new Error(`Face embedding extraction failed: ${errorMessage}`);
    }

    const data = (await response.json()) as FaceEmbeddingResponseDTO;
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    logger.warn('Error during face embedding AI service call', {
      service: 'ai-client',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Calls Python AI service to process a guest query selfie for AI face search.
 * Enforces strict exactly-one-face policy:
 * - 0 faces detected: throws NoFaceDetectedError (HTTP 422)
 * - >1 faces detected: throws MultipleFacesDetectedError (HTTP 422)
 * - 1 face detected: extracts 128-D L2-normalized vector embedding using SFace
 */
export async function processQuerySelfie(
  imageBuffer: Buffer
): Promise<ProcessQuerySelfieResponseDTO> {
  const config = getConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.aiService.timeoutMs * 2);

  const url = new URL(`${config.aiService.url}/process-query-selfie`);
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' });
  formData.append('file', blob, 'selfie.jpg');

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: getInternalHeaders(),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        detail?: { code?: string; message?: string } | string;
      };

      const detail = errorBody.detail;
      const code = typeof detail === 'object' && detail !== null ? detail.code : '';
      const message =
        typeof detail === 'object' && detail !== null
          ? detail.message || 'Selfie validation failed'
          : typeof detail === 'string'
            ? detail
            : `AI service returned HTTP ${response.status}`;

      if (code === 'NO_FACE_DETECTED' || response.status === 422 && message.includes('NO_FACE_DETECTED')) {
        throw new NoFaceDetectedError(message);
      }
      if (code === 'MULTIPLE_FACES_DETECTED' || response.status === 422 && message.includes('MULTIPLE_FACES_DETECTED')) {
        throw new MultipleFacesDetectedError(message);
      }
      if (code === 'INVALID_FACE_CROP' || code === 'ALIGNMENT_FAILED' || response.status === 400) {
        throw new InvalidSelfieError(message);
      }

      throw new Error(`Selfie face processing failed: ${message}`);
    }

    const data = (await response.json()) as ProcessQuerySelfieResponseDTO;
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (
      error instanceof NoFaceDetectedError ||
      error instanceof MultipleFacesDetectedError ||
      error instanceof InvalidSelfieError
    ) {
      throw error;
    }

    logger.warn('Error during query selfie AI service call', {
      service: 'ai-client',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

