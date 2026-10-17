import io
import unittest
import numpy as np
import cv2
from fastapi.testclient import TestClient
from main import app


def make_test_jpeg(width: int = 320, height: int = 320) -> bytes:
    img = np.full((height, width, 3), 128, dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


class TestFastApiEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_jpeg = make_test_jpeg()

    def test_health_check_endpoint(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["service"], "photography-ai-service")
        self.assertTrue(data["modelsLoaded"])
        self.assertIn("YuNet", data["detector"])
        self.assertIn("SFace", data["recognizer"])

    def test_ready_check_endpoint(self):
        res = self.client.get("/ready")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ready")
        self.assertTrue(data["modelsLoaded"])
        self.assertEqual(data["inferenceDevice"], "CPU")

        det = data["detector"]
        self.assertEqual(det["name"], "YuNet")
        self.assertEqual(det["version"], "2023mar")
        self.assertIn("MIT", det["license"])

        rec = data["recognizer"]
        self.assertEqual(rec["name"], "SFace")
        self.assertEqual(rec["version"], "v1")
        self.assertEqual(rec["embeddingDimension"], 128)
        self.assertIn("Apache 2.0", rec["license"])

    def test_detect_faces_endpoint_valid_image(self):
        files = {"file": ("test.jpg", io.BytesIO(self.test_jpeg), "image/jpeg")}
        res = self.client.post("/detect-faces", files=files)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIsInstance(data["faces"], list)
        self.assertIsInstance(data["faceCount"], int)

    def test_extract_embeddings_endpoint_valid_image(self):
        files = {"file": ("test.jpg", io.BytesIO(self.test_jpeg), "image/jpeg")}
        res = self.client.post("/extract-embeddings", files=files)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIsInstance(data["faces"], list)
        self.assertIsInstance(data["faceCount"], int)

    def test_detect_faces_corrupt_file_returns_400(self):
        corrupt_bytes = b"not_an_image"
        files = {"file": ("bad.jpg", io.BytesIO(corrupt_bytes), "image/jpeg")}
        res = self.client.post("/detect-faces", files=files)
        self.assertEqual(res.status_code, 400)

    def test_process_query_selfie_zero_face_returns_422(self):
        # Blank grey image has 0 faces -> should trigger 422 with NO_FACE_DETECTED
        files = {"file": ("selfie.jpg", io.BytesIO(self.test_jpeg), "image/jpeg")}
        res = self.client.post("/process-query-selfie", files=files)
        self.assertEqual(res.status_code, 422)
        data = res.json()
        self.assertIn("detail", data)
        detail = data["detail"]
        code = detail.get("code") if isinstance(detail, dict) else ""
        self.assertEqual(code, "NO_FACE_DETECTED")


if __name__ == "__main__":
    unittest.main()
