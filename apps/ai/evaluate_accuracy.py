#!/usr/bin/env python3
"""
Studio Lumina — AI Face Recognition Accuracy Evaluation Harness
Evaluates OpenCV YuNet (Face Detection) + SFace (Face Recognition / 128-D Embeddings).
Measures True Match Rate (TMR), False Match Rate (FMR/FAR), False Non-Match Rate (FNMR/FRR),
Precision, Recall, Top-k retrieval, and distance threshold sensitivity.
"""

import os
import sys
import math
import numpy as np
import cv2
from typing import List, Dict, Tuple, Any

# Ensure apps/ai directory is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from biometrics import BiometricEngine
from config import settings


def generate_synthetic_identity_face(
    base_hue: int = 25,
    variation_seed: int = 0,
    width: int = 320,
    height: int = 320,
    noise_level: float = 0.0,
    brightness_factor: float = 1.0,
    blur_ksize: int = 0,
    glasses: bool = False,
    yaw_offset: int = 0,
) -> bytes:
    """
    Generates a deterministic synthetic face matrix suitable for YuNet face detection
    and SFace landmark alignment and embedding extraction.
    Ensures repeatable evaluation without scraping third-party biometric data.
    """
    np.random.seed(variation_seed)
    img = np.zeros((height, width, 3), dtype=np.uint8)

    # Background gradient
    bg_color = (40, 40, 45)
    img[:] = bg_color

    cx = width // 2 + yaw_offset
    cy = height // 2

    # Skin tone in HSV
    skin_hsv = np.array([[[base_hue % 180, 110, int(min(255, 200 * brightness_factor))]]], dtype=np.uint8)
    skin_bgr = cv2.cvtColor(skin_hsv, cv2.COLOR_HSV2BGR)[0, 0]
    b, g, r = int(skin_bgr[0]), int(skin_bgr[1]), int(skin_bgr[2])

    # Head oval
    face_w, face_h = 75, 105
    cv2.ellipse(img, (cx, cy), (face_w, face_h), 0, 0, 360, (b, g, r), -1)

    # Hair
    hair_color = (20, 20, 25)
    cv2.ellipse(img, (cx, cy - 50), (face_w + 5, 60), 0, 180, 360, hair_color, -1)

    # Eyes (landmarks for YuNet)
    eye_y = cy - 15
    left_eye_x = cx - 30
    right_eye_x = cx + 30

    cv2.circle(img, (left_eye_x, eye_y), 9, (240, 240, 245), -1)
    cv2.circle(img, (right_eye_x, eye_y), 9, (240, 240, 245), -1)
    cv2.circle(img, (left_eye_x, eye_y), 4, (30, 20, 15), -1)
    cv2.circle(img, (right_eye_x, eye_y), 4, (30, 20, 15), -1)

    # Eyebrows
    cv2.line(img, (left_eye_x - 14, eye_y - 12), (left_eye_x + 14, eye_y - 12), (25, 20, 15), 3)
    cv2.line(img, (right_eye_x - 14, eye_y - 12), (right_eye_x + 14, eye_y - 12), (25, 20, 15), 3)

    # Nose
    nose_y = cy + 15
    cv2.line(img, (cx, eye_y + 5), (cx, nose_y), (max(0, b - 25), max(0, g - 25), max(0, r - 25)), 3)
    cv2.circle(img, (cx - 7, nose_y), 3, (max(0, b - 35), max(0, g - 35), max(0, r - 35)), -1)
    cv2.circle(img, (cx + 7, nose_y), 3, (max(0, b - 35), max(0, g - 35), max(0, r - 35)), -1)

    # Mouth
    mouth_y = cy + 45
    cv2.ellipse(img, (cx, mouth_y), (22, 9), 0, 0, 180, (50, 40, 150), -1)
    cv2.line(img, (cx - 22, mouth_y), (cx + 22, mouth_y), (max(0, b - 40), max(0, g - 40), max(0, r - 40)), 2)

    # Glasses (optional condition)
    if glasses:
        glass_color = (210, 210, 210)
        cv2.circle(img, (left_eye_x, eye_y), 18, glass_color, 2)
        cv2.circle(img, (right_eye_x, eye_y), 18, glass_color, 2)
        cv2.line(img, (left_eye_x + 18, eye_y), (right_eye_x - 18, eye_y), glass_color, 2)

    # Noise / texture
    if noise_level > 0:
        noise = np.random.normal(0, noise_level * 255, img.shape).astype(np.int16)
        img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Blur (optional condition)
    if blur_ksize > 1:
        k = blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1
        img = cv2.GaussianBlur(img, (k, k), 0)

    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return buf.tobytes()


def calculate_cosine_distance(v1: np.ndarray, v2: np.ndarray) -> float:
    """Calculates cosine distance: 1.0 - (v1 . v2) / (||v1|| * ||v2||)."""
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 1.0
    dot = np.dot(v1, v2)
    sim = dot / (norm1 * norm2)
    return float(np.clip(1.0 - sim, 0.0, 2.0))


def run_accuracy_evaluation(num_identities: int = 15, variations_per_identity: int = 5):
    """
    Executes a comprehensive, reproducible accuracy evaluation harness:
    1. Generates controlled genuine pairs (same identity under lighting, angle, noise, glasses variation).
    2. Generates impostor pairs (distinct identities).
    3. Evaluates detection success rate and embedding extraction.
    4. Computes genuine vs impostor distance distributions.
    5. Evaluates candidate thresholds: 0.20, 0.25, 0.30, 0.33, 0.363, 0.40, 0.45, 0.50.
    6. Measures TMR (True Match Rate), FMR (False Match Rate), FNMR (False Non-Match Rate), Precision, Recall.
    7. Tests top-k retrieval performance.
    """
    print("=" * 75)
    print("STUDIO LUMINA — AI FACE RECOGNITION ACCURACY & THRESHOLD CALIBRATION")
    print("=" * 75)

    engine = BiometricEngine.get_instance()
    info = engine.get_model_info()
    print(f"Detector:         {info['detector']['name']} ({info['detector']['version']})")
    print(f"Recognizer:       {info['recognizer']['name']} ({info['recognizer']['version']})")
    print(f"Dimension:        {info['recognizer']['embeddingDimension']}-D L2-normalized float vector")
    print(f"Inference Device: {info['inferenceDevice']}")
    print(f"Identities:       {num_identities} synthetic identities ({variations_per_identity} variations each)")
    print("-" * 75)

    # 1. Generate identity samples and extract embeddings
    identity_embeddings: Dict[int, List[np.ndarray]] = {}
    failed_extractions = 0
    total_images = 0

    print("Generating evaluation identities and extracting embeddings...")
    for id_idx in range(num_identities):
        identity_embeddings[id_idx] = []
        base_hue = (id_idx * 17 + 12) % 180

        # Variation 0: Neutral / Reference Gallery Image
        for var_idx in range(variations_per_identity):
            total_images += 1
            # Conditions
            brightness = 1.0 + (0.15 * (var_idx - 1)) if var_idx > 0 else 1.0
            noise = 0.03 * var_idx
            blur = 3 if var_idx == 3 else 0
            glasses = (var_idx == 4)
            yaw = -10 if var_idx == 1 else (10 if var_idx == 2 else 0)

            img_bytes = generate_synthetic_identity_face(
                base_hue=base_hue,
                variation_seed=(id_idx * 100 + var_idx),
                brightness_factor=brightness,
                noise_level=noise,
                blur_ksize=blur,
                glasses=glasses,
                yaw_offset=yaw,
            )

            try:
                faces = engine.extract_face_embeddings(img_bytes)
                if len(faces) > 0:
                    emb = np.array(faces[0]["embedding"], dtype=np.float32)
                    identity_embeddings[id_idx].append(emb)
                else:
                    failed_extractions += 1
            except Exception as e:
                failed_extractions += 1

    extracted_counts = [len(embs) for embs in identity_embeddings.values()]
    print(f"Total Images: {total_images} | Extracted: {sum(extracted_counts)} | Failed Detections: {failed_extractions}")

    # 2. Build Genuine Pairs (Same identity: idx == idy)
    genuine_distances: List[float] = []
    for id_idx, embs in identity_embeddings.items():
        n = len(embs)
        for i in range(n):
            for j in range(i + 1, n):
                dist = calculate_cosine_distance(embs[i], embs[j])
                genuine_distances.append(dist)

    # 3. Build Impostor Pairs (Different identity: idx != idy)
    impostor_distances: List[float] = []
    id_list = list(identity_embeddings.keys())
    for i in range(len(id_list)):
        for j in range(i + 1, len(id_list)):
            id_a, id_b = id_list[i], id_list[j]
            # Compare first 2 samples of each
            for ea in identity_embeddings[id_a][:2]:
                for eb in identity_embeddings[id_b][:2]:
                    dist = calculate_cosine_distance(ea, eb)
                    impostor_distances.append(dist)

    gen_arr = np.array(genuine_distances)
    imp_arr = np.array(impostor_distances)

    print("\nDISTANCE DISTRIBUTION METRICS:")
    print(f"Genuine Pairs Evaluated:  {len(gen_arr)}")
    print(f"  Min Distance:  {np.min(gen_arr):.4f} (Max Sim: {1 - np.min(gen_arr):.4f})")
    print(f"  Mean Distance: {np.mean(gen_arr):.4f} (Mean Sim: {1 - np.mean(gen_arr):.4f})")
    print(f"  Max Distance:  {np.max(gen_arr):.4f} (Min Sim: {1 - np.max(gen_arr):.4f})")
    print(f"  Std Dev:       {np.std(gen_arr):.4f}")

    print(f"\nImpostor Pairs Evaluated: {len(imp_arr)}")
    print(f"  Min Distance:  {np.min(imp_arr):.4f} (Max Sim: {1 - np.min(imp_arr):.4f})")
    print(f"  Mean Distance: {np.mean(imp_arr):.4f} (Mean Sim: {1 - np.mean(imp_arr):.4f})")
    print(f"  Max Distance:  {np.max(imp_arr):.4f} (Min Sim: {1 - np.max(imp_arr):.4f})")
    print(f"  Std Dev:       {np.std(imp_arr):.4f}")

    # Biometric separability (d-prime)
    d_prime = (np.mean(imp_arr) - np.mean(gen_arr)) / math.sqrt(0.5 * (np.var(gen_arr) + np.var(imp_arr)))
    print(f"\nBiometric Separability Index (d-prime): {d_prime:.2f}")

    # 4. Threshold Sweep Evaluation
    candidate_thresholds = [0.20, 0.25, 0.30, 0.33, 0.363, 0.40, 0.45, 0.50]
    results_table = []

    print("\n" + "=" * 80)
    print(f"{'Threshold (Dist)':<16} | {'TMR (TPR)':<10} | {'FNMR (FRR)':<11} | {'FMR (FAR)':<10} | {'Precision':<10} | {'Recall':<8} | {'F1':<6}")
    print("-" * 80)

    for th in candidate_thresholds:
        # Match condition: distance <= threshold
        tp = int(np.sum(gen_arr <= th))
        fn = int(np.sum(gen_arr > th))
        fp = int(np.sum(imp_arr <= th))
        tn = int(np.sum(imp_arr > th))

        tmr = tp / len(gen_arr) if len(gen_arr) > 0 else 0.0
        fnmr = fn / len(gen_arr) if len(gen_arr) > 0 else 0.0
        fmr = fp / len(imp_arr) if len(imp_arr) > 0 else 0.0
        precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
        recall = tmr
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

        is_calibrated = (th == 0.363)
        marker = " <-- Calibrated" if is_calibrated else ""
        print(f"{th:<16.3f} | {tmr:<10.1%} | {fnmr:<11.1%} | {fmr:<10.2%} | {precision:<10.2%} | {recall:<8.1%} | {f1:<6.3f}{marker}")

        results_table.append({
            "threshold": th,
            "tmr": tmr,
            "fnmr": fnmr,
            "fmr": fmr,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "is_calibrated": is_calibrated,
        })

    print("-" * 80)

    # 5. Top-k Retrieval Evaluation
    # Simulate a guest gallery of 50 photos: 5 matching photos of Person X, 45 photos of other people
    print("\nTOP-K RETRIEVAL PERFORMANCE EVALUATION (Gallery of 50 photos):")
    top_1_hits = 0
    top_3_hits = 0
    top_5_hits = 0
    total_queries = 0

    for query_id in identity_embeddings:
        if len(identity_embeddings[query_id]) < 2:
            continue
        query_vec = identity_embeddings[query_id][0]
        genuine_gallery_vecs = identity_embeddings[query_id][1:]

        # Gallery pool
        gallery_items = []
        for g_vec in genuine_gallery_vecs:
            gallery_items.append({"id": query_id, "is_match": True, "vec": g_vec})
        for other_id in identity_embeddings:
            if other_id == query_id:
                continue
            for o_vec in identity_embeddings[other_id][:2]:
                gallery_items.append({"id": other_id, "is_match": False, "vec": o_vec})

        # Rank by distance
        ranked = sorted(
            gallery_items,
            key=lambda item: calculate_cosine_distance(query_vec, item["vec"])
        )

        total_queries += 1
        if any(item["is_match"] for item in ranked[:1]):
            top_1_hits += 1
        if any(item["is_match"] for item in ranked[:3]):
            top_3_hits += 1
        if any(item["is_match"] for item in ranked[:5]):
            top_5_hits += 1

    top_1_acc = (top_1_hits / total_queries) * 100 if total_queries > 0 else 0
    top_3_acc = (top_3_hits / total_queries) * 100 if total_queries > 0 else 0
    top_5_acc = (top_5_hits / total_queries) * 100 if total_queries > 0 else 0

    print(f"Top-1 Retrieval Accuracy: {top_1_acc:.1f}% ({top_1_hits}/{total_queries})")
    print(f"Top-3 Retrieval Accuracy: {top_3_acc:.1f}% ({top_3_hits}/{total_queries})")
    print(f"Top-5 Retrieval Accuracy: {top_5_acc:.1f}% ({top_5_hits}/{total_queries})")
    print("=" * 75)

    return {
        "num_identities": num_identities,
        "genuine_pairs": len(gen_arr),
        "impostor_pairs": len(imp_arr),
        "d_prime": round(float(d_prime), 2),
        "gen_mean_dist": round(float(np.mean(gen_arr)), 4),
        "imp_mean_dist": round(float(np.mean(imp_arr)), 4),
        "top_1_accuracy": top_1_acc,
        "top_3_accuracy": top_3_acc,
        "top_5_accuracy": top_5_acc,
        "threshold_results": results_table,
    }


if __name__ == "__main__":
    run_accuracy_evaluation()
