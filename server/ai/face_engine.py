#!/usr/bin/env python3
"""
AI Face Detection & Embedding Engine using OpenCV YuNet + SFace.
Detects all faces in an image, aligns them, generates 128-D L2-normalized embeddings.
"""

import sys
import os
import json
import numpy as np
import cv2

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
YUNET_PATH = os.path.join(MODELS_DIR, 'face_detection_yunet_2023mar.onnx')
SFACE_PATH = os.path.join(MODELS_DIR, 'face_recognition_sface_2021dec.onnx')

# Initialize models
_detector = None
_recognizer = None

def get_models():
    global _detector, _recognizer
    if _detector is None or _recognizer is None:
        if not os.path.exists(YUNET_PATH) or not os.path.exists(SFACE_PATH):
            raise FileNotFoundError("ONNX models not found in " + MODELS_DIR)
        _detector = cv2.FaceDetectorYN.create(
            YUNET_PATH,
            "",
            (320, 320),
            score_threshold=0.7,
            nms_threshold=0.3,
            top_k=5000
        )
        _recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
    return _detector, _recognizer

def detect_and_embed(image_path):
    """
    Reads an image, runs YuNet to detect faces,
    aligns faces and runs SFace to produce 128D embeddings.
    Returns a list of dicts:
    [{ 'face_index': 0, 'box': {'x': ..., 'y': ..., 'w': ..., 'h': ...}, 'confidence': ..., 'embedding': [...] }]
    """
    if not os.path.exists(image_path):
        return {"error": f"File not found: {image_path}", "faces": []}

    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"Failed to decode image: {image_path}", "faces": []}

    h, w, _ = img.shape
    detector, recognizer = get_models()

    # Dynamic input size for YuNet
    # Resize if image is huge (> 1600px) to maintain high performance
    scale = 1.0
    max_dim = 1600
    if max(h, w) > max_dim:
        scale = max_dim / float(max(h, w))
        target_w = int(w * scale)
        target_h = int(h * scale)
        detect_img = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)
    else:
        detect_img = img

    dh, dw, _ = detect_img.shape
    detector.setInputSize((dw, dh))

    # Detect faces: returns [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
    _, faces = detector.detect(detect_img)

    results = []
    if faces is not None and len(faces) > 0:
        for idx, face in enumerate(faces):
            # Scale coordinates back if resized
            if scale != 1.0:
                face_scaled = face.copy()
                face_scaled[0:14] = face_scaled[0:14] / scale
            else:
                face_scaled = face.copy()

            box_x = float(max(0, face_scaled[0]))
            box_y = float(max(0, face_scaled[1]))
            box_w = float(face_scaled[2])
            box_h = float(face_scaled[3])
            confidence = float(face_scaled[-1])

            # Align face using SFace
            # Note: alignCrop requires the face detection vector matching the image passed to it
            try:
                # Use detect_img with the unscaled face vector
                aligned_face = recognizer.alignCrop(detect_img, face)
                feature = recognizer.feature(aligned_face) # 1x128 float32
                embedding = feature.flatten().tolist()

                results.append({
                    "face_index": idx,
                    "box": {
                        "x": round(box_x, 1),
                        "y": round(box_y, 1),
                        "w": round(box_w, 1),
                        "h": round(box_h, 1)
                    },
                    "confidence": round(confidence, 4),
                    "embedding": embedding
                })
            except Exception as e:
                # Face alignment error (e.g. edge boundary)
                continue

    return {
        "success": True,
        "image_width": w,
        "image_height": h,
        "faces_detected": len(results),
        "faces": results
    }

def match_selfie(selfie_path, candidates_file, threshold=0.363):
    """
    Extracts embedding from guest selfie,
    compares against candidate embeddings from current event,
    returns matched photo IDs sorted by highest similarity.
    Threshold: SFace cosine distance threshold ~0.363 (lower = closer match).
    Cosine similarity = 1.0 - (cosine distance / 2.0) or dot product of normalized vectors.
    """
    selfie_res = detect_and_embed(selfie_path)
    if not selfie_res.get("faces") or len(selfie_res["faces"]) == 0:
        return {
            "success": False,
            "error": "No face detected in the provided selfie. Please take a clear, well-lit photo of your face.",
            "matches": []
        }

    # Use the primary/largest face in the selfie
    selfie_faces = sorted(selfie_res["faces"], key=lambda f: f["box"]["w"] * f["box"]["h"], reverse=True)
    selfie_embedding = np.array(selfie_faces[0]["embedding"], dtype=np.float32)
    selfie_norm = np.linalg.norm(selfie_embedding)
    if selfie_norm > 0:
        selfie_embedding = selfie_embedding / selfie_norm

    with open(candidates_file, 'r', encoding='utf-8') as f:
        candidates = json.load(f)

    matches = {}
    for cand in candidates:
        photo_id = cand["photo_id"]
        cand_emb = np.array(cand["embedding"], dtype=np.float32)
        cand_norm = np.linalg.norm(cand_emb)
        if cand_norm > 0:
            cand_emb = cand_emb / cand_norm

        # Cosine similarity: range [-1, 1], identical is 1.0
        # SFace cosine distance: 1 - cosine_similarity.
        # Match threshold in cosine similarity: ~0.65 or higher.
        cos_sim = float(np.dot(selfie_embedding, cand_emb))
        
        # SFace typical match threshold is cosine similarity >= 0.63
        if cos_sim >= 0.60:
            if photo_id not in matches or cos_sim > matches[photo_id]["similarity"]:
                matches[photo_id] = {
                    "photo_id": photo_id,
                    "similarity": round(cos_sim, 4),
                    "face_index": cand.get("face_index", 0),
                    "box": cand.get("box", {})
                }

    sorted_matches = sorted(matches.values(), key=lambda m: m["similarity"], reverse=True)
    return {
        "success": True,
        "selfie_faces_detected": len(selfie_res["faces"]),
        "matched_count": len(sorted_matches),
        "matches": sorted_matches
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python face_engine.py <detect|match> <path> [candidates_json]"}))
        sys.exit(1)

    cmd = sys.argv[1]
    path = sys.argv[2]

    try:
        if cmd == "detect":
            res = detect_and_embed(path)
            print(json.dumps(res))
        elif cmd == "match":
            if len(sys.argv) < 4:
                print(json.dumps({"error": "Candidates JSON file required for match"}))
                sys.exit(1)
            candidates_path = sys.argv[3]
            res = match_selfie(path, candidates_path)
            print(json.dumps(res))
        else:
            print(json.dumps({"error": f"Unknown command: {cmd}"}))
            sys.exit(1)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
