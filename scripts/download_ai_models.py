"""
Studio Lumina — AI Biometric Model Setup Script
Downloads official OpenCV YuNet face detection and SFace face recognition ONNX models.
"""
import os
import urllib.request

MODELS = {
    "face_detection_yunet_2023mar.onnx": "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx": "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
}

def download_models():
    target_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "apps", "ai", "models")
    os.makedirs(target_dir, exist_ok=True)

    for filename, url in MODELS.items():
        destination = os.path.join(target_dir, filename)
        if os.path.exists(destination) and os.path.getsize(destination) > 1000:
            print(f"[OK] {filename} already exists ({os.path.getsize(destination)} bytes)")
            continue

        print(f"[DOWNLOADING] {filename} from {url}...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp, open(destination, "wb") as f:
            f.write(resp.read())
        print(f"[DONE] {filename} downloaded ({os.path.getsize(destination)} bytes)")

if __name__ == "__main__":
    download_models()
