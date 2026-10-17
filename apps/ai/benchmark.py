#!/usr/bin/env python3
"""
Benchmark script for OpenCV YuNet (Face Detection) + SFace (Face Recognition / 128-D Embeddings).
Measures CPU inference latency across representative image sizes and multiple iterations.
"""

import time
import numpy as np
import cv2
from biometrics import BiometricEngine


def generate_benchmark_image(width: int = 1280, height: int = 720) -> bytes:
    """Generates a synthetic high-resolution image buffer for latency benchmarks."""
    img = np.random.randint(60, 200, (height, width, 3), dtype=np.uint8)
    # Draw simple gradient/contrast
    for y in range(0, height, 100):
        cv2.line(img, (0, y), (width, y), (255, 255, 255), 2)
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


def run_benchmark(iterations: int = 20):
    print("=" * 65)
    print("STUDIO LUMINA — AI BIOMETRICS BENCHMARK (YuNet + SFace)")
    print("=" * 65)

    engine = BiometricEngine.get_instance()
    info = engine.get_model_info()
    print(f"Device:           {info['inferenceDevice']}")
    print(f"Detector:         {info['detector']['name']} ({info['detector']['version']})")
    print(f"Recognizer:       {info['recognizer']['name']} ({info['recognizer']['version']})")
    print(f"Embedding Dim:    {info['recognizer']['embeddingDimension']}")
    print(f"Licenses:         Detector: {info['detector']['license']} | Recognizer: {info['recognizer']['license']}")
    print(f"Iterations:       {iterations}")
    print("-" * 65)

    test_img = generate_benchmark_image(1280, 720)
    print(f"Test image payload: {len(test_img) // 1024} KB (1280x720)")

    # Warmup
    print("Warming up models in memory...")
    for _ in range(3):
        engine.detect_faces(test_img)

    # Benchmark Detection
    detection_latencies = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        engine.detect_faces(test_img)
        t1 = time.perf_counter()
        detection_latencies.append((t1 - t0) * 1000)

    # Benchmark Embedding extraction
    embedding_latencies = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        engine.extract_face_embeddings(test_img)
        t1 = time.perf_counter()
        embedding_latencies.append((t1 - t0) * 1000)

    def stats(latencies):
        arr = np.array(latencies)
        return {
            "min": round(float(np.min(arr)), 2),
            "mean": round(float(np.mean(arr)), 2),
            "max": round(float(np.max(arr)), 2),
            "p95": round(float(np.percentile(arr, 95)), 2),
            "fps": round(1000.0 / float(np.mean(arr)), 1),
        }

    det_s = stats(detection_latencies)
    emb_s = stats(embedding_latencies)

    print("\nBENCHMARK RESULTS:")
    print(f"1. Face Detection (YuNet @ 1280x720):")
    print(f"   Min:  {det_s['min']} ms | Mean: {det_s['mean']} ms | P95: {det_s['p95']} ms | Max: {det_s['max']} ms | Throughput: {det_s['fps']} FPS")

    print(f"2. End-to-End Extraction (Detection + Alignment + SFace 128-D):")
    print(f"   Min:  {emb_s['min']} ms | Mean: {emb_s['mean']} ms | P95: {emb_s['p95']} ms | Max: {emb_s['max']} ms | Throughput: {emb_s['fps']} FPS")

    print("-" * 65)
    print("VERIFICATION CRITERIA:")
    if emb_s['mean'] < 120.0:
        print("[PASS] Sub-120ms average CPU inference latency confirmed.")
    else:
        print("[WARN] Inference latency above 120ms target.")
    print("=" * 65)


if __name__ == "__main__":
    run_benchmark()
