import hashlib
import os
import urllib.request

MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "url": "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "size": 232589,
    },
    "face_recognition_sface_2021dec.onnx": {
        "url": "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "size": 38696353,
    },
}

def verify_checksum(filepath: str, expected_sha256: str) -> bool:
    if not os.path.exists(filepath):
        return False
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest().lower() == expected_sha256.lower()

def download_models():
    target_dir = os.path.join(os.path.dirname(__file__), "models")
    os.makedirs(target_dir, exist_ok=True)

    for filename, meta in MODELS.items():
        destination = os.path.join(target_dir, filename)
        url = meta["url"]
        expected_sha256 = meta["sha256"]

        if os.path.exists(destination):
            if verify_checksum(destination, expected_sha256):
                print(f"[OK] {filename} verified (SHA256 valid, {os.path.getsize(destination)} bytes)")
                continue
            else:
                print(f"[WARN] {filename} checksum mismatch or corrupted! Re-downloading...")
                try:
                    os.remove(destination)
                except OSError:
                    pass

        print(f"[DOWNLOADING] {filename} from {url}...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(destination, "wb") as f:
            while chunk := resp.read(65536):
                f.write(chunk)

        if not verify_checksum(destination, expected_sha256):
            raise ValueError(f"Downloaded model {filename} failed SHA256 integrity verification!")

        print(f"[DONE] {filename} downloaded and verified ({os.path.getsize(destination)} bytes)")

if __name__ == "__main__":
    download_models()
