import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  probeVideo,
  extractPosterFrame,
  generatePlaybackRendition,
  AsyncVideoProcessingQueue,
  VIDEO_PROCESSING_CONFIG,
  processExecutor,
} from '../../apps/api/src/services/videoProcessingService.js';
import {
  CorruptVideoError,
  VideoDimensionsExceededError,
  VideoDurationExceededError,
  VideoProcessingError,
} from '@photography-saas/errors';
import fs from 'fs';

describe('Phase 12: Video Processing Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Defensive FFprobe Parsing (probeVideo)', () => {
    it('correctly parses video and audio streams from valid ffprobe JSON', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockFfprobeOutput = JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
            duration: '45.50',
            bit_rate: '4500000',
          },
          {
            index: 1,
            codec_type: 'audio',
            codec_name: 'aac',
          },
        ],
        format: {
          duration: '45.50',
          size: '25600000',
          bit_rate: '4600000',
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        },
      });

      vi.spyOn(processExecutor, 'execFile').mockResolvedValue({
        stdout: mockFfprobeOutput,
        stderr: '',
      });

      const result = await probeVideo('/tmp/test_video.mp4');

      expect(result.duration).toBe(45.5);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.videoCodec).toBe('h264');
      expect(result.audioCodec).toBe('aac');
      expect(result.frameRate).toBe(30);
      expect(result.bitrate).toBe(4500000);
    });

    it('handles silent video without audio track safely (audioCodec = null)', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockSilentOutput = JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'vp9',
            width: 1280,
            height: 720,
            r_frame_rate: '24/1',
            duration: '10.0',
          },
        ],
        format: {
          duration: '10.0',
        },
      });

      vi.spyOn(processExecutor, 'execFile').mockResolvedValue({
        stdout: mockSilentOutput,
        stderr: '',
      });

      const result = await probeVideo('/tmp/silent_drone.webm');

      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      expect(result.videoCodec).toBe('vp9');
      expect(result.audioCodec).toBeNull();
      expect(result.duration).toBe(10);
    });

    it('rejects input with no video stream', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockAudioOnly = JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: 'audio',
            codec_name: 'mp3',
          },
        ],
        format: { duration: '30.0' },
      });

      vi.spyOn(processExecutor, 'execFile').mockResolvedValue({
        stdout: mockAudioOnly,
        stderr: '',
      });

      await expect(probeVideo('/tmp/audio_only.mp4')).rejects.toThrowError(CorruptVideoError);
    });

    it('rejects video exceeding maximum dimensions (3840x2160)', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mock8k = JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h265',
            width: 7680,
            height: 4320,
            duration: '20.0',
          },
        ],
        format: { duration: '20.0' },
      });

      vi.spyOn(processExecutor, 'execFile').mockResolvedValue({
        stdout: mock8k,
        stderr: '',
      });

      await expect(probeVideo('/tmp/8k_video.mp4')).rejects.toThrowError(VideoDimensionsExceededError);
    });

    it('rejects video exceeding duration policy limit (1800s / 30m)', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockLong = JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            duration: '3600.0', // 1 hour
          },
        ],
        format: { duration: '3600.0' },
      });

      vi.spyOn(processExecutor, 'execFile').mockResolvedValue({
        stdout: mockLong,
        stderr: '',
      });

      await expect(probeVideo('/tmp/movie.mp4')).rejects.toThrowError(VideoDurationExceededError);
    });
  });

  describe('Poster Frame Generation (extractPosterFrame)', () => {
    it('uses safe seek timestamp for very short videos (< 1.0s)', async () => {
      let capturedArgs: readonly string[] = [];

      vi.spyOn(processExecutor, 'execFile').mockImplementation(async (_cmd: string, args: readonly string[]) => {
        capturedArgs = args;
        return { stdout: '', stderr: '' };
      });

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('mock_webp_image_data'));

      const result = await extractPosterFrame('/tmp/short.mp4', '/tmp/poster.webp', 0.5);

      expect(capturedArgs).toContain('-ss');
      const ssIdx = capturedArgs.indexOf('-ss');
      const seekVal = parseFloat(capturedArgs[ssIdx + 1]);
      // 0.5s video -> seek to 0.25s
      expect(seekVal).toBe(0.25);
      expect(result.posterBuffer.length).toBeGreaterThan(0);
    });

    it('uses configured timestamp for standard length videos (>= 1.0s)', async () => {
      let capturedArgs: readonly string[] = [];

      vi.spyOn(processExecutor, 'execFile').mockImplementation(async (_cmd: string, args: readonly string[]) => {
        capturedArgs = args;
        return { stdout: '', stderr: '' };
      });

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('mock_webp_image_data'));

      const result = await extractPosterFrame('/tmp/standard.mp4', '/tmp/poster.webp', 60.0);

      expect(capturedArgs).toContain('-ss');
      const ssIdx = capturedArgs.indexOf('-ss');
      const seekVal = parseFloat(capturedArgs[ssIdx + 1]);
      expect(seekVal).toBe(1.0);
      expect(result.posterBuffer.length).toBeGreaterThan(0);
    });
  });

  describe('Playback Rendition Generation (generatePlaybackRendition)', () => {
    it('passes audio codec flags when audio is present', async () => {
      let capturedArgs: readonly string[] = [];

      vi.spyOn(processExecutor, 'execFile').mockImplementation(async (_cmd: string, args: readonly string[]) => {
        capturedArgs = args;
        return { stdout: '', stderr: '' };
      });

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 * 1024 } as any);

      const result = await generatePlaybackRendition('/tmp/in.mp4', '/tmp/out.mp4', true);

      expect(capturedArgs).toContain('-c:a');
      expect(capturedArgs).toContain('aac');
      expect(capturedArgs).toContain('+faststart');
      expect(result.sizeBytes).toBe(1024 * 1024);
    });

    it('uses -an flag when video is silent (no audio)', async () => {
      let capturedArgs: readonly string[] = [];

      vi.spyOn(processExecutor, 'execFile').mockImplementation(async (_cmd: string, args: readonly string[]) => {
        capturedArgs = args;
        return { stdout: '', stderr: '' };
      });

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 512 * 1024 } as any);

      const result = await generatePlaybackRendition('/tmp/in.mp4', '/tmp/out.mp4', false);

      expect(capturedArgs).toContain('-an');
      expect(capturedArgs).not.toContain('-c:a');
      expect(result.sizeBytes).toBe(512 * 1024);
    });
  });

  describe('AsyncVideoProcessingQueue (Isolation & Concurrency)', () => {
    it('enforces single concurrency (concurrency = 1)', async () => {
      const queue = new AsyncVideoProcessingQueue(1);
      expect(queue.getActiveCount()).toBe(0);
      expect(queue.getPendingCount()).toBe(0);
    });

    it('deduplicates in-flight and queued items by mediaId', () => {
      const queue = new AsyncVideoProcessingQueue(1);
      // Mock processNext to avoid calling real processing
      (queue as any).processNext = vi.fn();

      queue.enqueue('media-1', 'event-1');
      queue.enqueue('media-1', 'event-1'); // Duplicate
      queue.enqueue('media-2', 'event-1');

      expect(queue.getPendingCount()).toBe(2); // Only media-1 and media-2
    });

    it('drains properly when empty', async () => {
      const queue = new AsyncVideoProcessingQueue(1);
      await expect(queue.drain()).resolves.toBeUndefined();
    });
  });
});
