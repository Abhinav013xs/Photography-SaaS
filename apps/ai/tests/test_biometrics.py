import unittest
import numpy as np
import cv2
from typing import Optional, Tuple
from biometrics import (
    BaseFaceDetector,
    BaseFaceRecognizer,
    YuNetFaceDetector,
    SFaceFaceRecognizer,
    BiometricEngine,
)


class MockDetector(BaseFaceDetector):
    def __init__(self, faces_to_return: Optional[np.ndarray] = None):
        self._faces = faces_to_return
        self._size = (320, 320)

    @property
    def model_name(self) -> str:
        return "MockYuNet"

    @property
    def model_version(self) -> str:
        return "mock-v1"

    @property
    def license(self) -> str:
        return "MIT"

    @property
    def is_ready(self) -> bool:
        return True

    def set_input_size(self, size: Tuple[int, int]) -> None:
        self._size = size

    def detect(self, img: np.ndarray, min_confidence: Optional[float] = None) -> Tuple[int, Optional[np.ndarray]]:
        return 1, self._faces


class MockRecognizer(BaseFaceRecognizer):
    def __init__(self, vector_dim: int = 128, produce_nan: bool = False):
        self._dim = vector_dim
        self._produce_nan = produce_nan

    @property
    def model_name(self) -> str:
        return "MockSFace"

    @property
    def model_version(self) -> str:
        return "mock-v1"

    @property
    def license(self) -> str:
        return "Apache 2.0"

    @property
    def embedding_dimension(self) -> int:
        return self._dim

    @property
    def is_ready(self) -> bool:
        return True

    def align_crop(self, img: np.ndarray, face: np.ndarray) -> Optional[np.ndarray]:
        return np.zeros((112, 112, 3), dtype=np.uint8)

    def extract_feature(self, aligned_face: np.ndarray) -> np.ndarray:
        vec = np.ones((1, self._dim), dtype=np.float32)
        if self._produce_nan:
            vec[0, 0] = np.nan
        return vec


def make_valid_jpeg(width: int = 320, height: int = 320) -> bytes:
    img = np.full((height, width, 3), 128, dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


class TestBiometricEngine(unittest.TestCase):
    def setUp(self):
        self.test_jpeg = make_valid_jpeg()

    def test_model_info_returns_correct_metadata(self):
        engine = BiometricEngine.get_instance()
        info = engine.get_model_info()

        self.assertEqual(info["status"], "ready")
        self.assertTrue(info["modelsLoaded"])
        self.assertEqual(info["inferenceDevice"], "CPU")

        detector_info = info["detector"]
        self.assertEqual(detector_info["name"], "YuNet")
        self.assertEqual(detector_info["version"], "2023mar")
        self.assertIn("MIT", detector_info["license"])
        self.assertTrue(detector_info["ready"])

        recognizer_info = info["recognizer"]
        self.assertEqual(recognizer_info["name"], "SFace")
        self.assertEqual(recognizer_info["version"], "v1")
        self.assertIn("Apache 2.0", recognizer_info["license"])
        self.assertEqual(recognizer_info["embeddingDimension"], 128)
        self.assertTrue(recognizer_info["ready"])

    def test_decode_image_validates_buffer_and_dimensions(self):
        engine = BiometricEngine.get_instance()

        # Empty buffer
        with self.assertRaises(ValueError) as ctx:
            engine.decode_image(b"")
        self.assertIn("too small", str(ctx.exception))

        # Corrupt data
        with self.assertRaises(ValueError) as ctx:
            engine.decode_image(b"this_is_not_an_image_file")
        self.assertIn("Corrupt or unsupported", str(ctx.exception))

        # Valid image
        decoded = engine.decode_image(self.test_jpeg)
        self.assertEqual(decoded.shape, (320, 320, 3))

    def test_zero_faces_detected_handling(self):
        mock_det = MockDetector(faces_to_return=None)
        mock_rec = MockRecognizer()
        engine = BiometricEngine(detector=mock_det, recognizer=mock_rec)

        detections = engine.detect_faces(self.test_jpeg)
        self.assertEqual(len(detections), 0)

        embeddings = engine.extract_face_embeddings(self.test_jpeg)
        self.assertEqual(len(embeddings), 0)

    def test_single_face_detection_and_embedding(self):
        # YuNet face row: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
        face_row = np.array([[50, 60, 100, 120, 70, 80, 110, 80, 90, 100, 80, 130, 100, 130, 0.95]], dtype=np.float32)
        mock_det = MockDetector(faces_to_return=face_row)
        mock_rec = MockRecognizer(vector_dim=128)
        engine = BiometricEngine(detector=mock_det, recognizer=mock_rec)

        embeddings = engine.extract_face_embeddings(self.test_jpeg)
        self.assertEqual(len(embeddings), 1)

        first = embeddings[0]
        self.assertEqual(first["faceIndex"], 0)
        self.assertEqual(first["modelName"], "MockSFace")
        self.assertEqual(first["modelVersion"], "mock-v1")
        self.assertEqual(len(first["embedding"]), 128)

        # Verify L2 unit norm
        norm = np.linalg.norm(np.array(first["embedding"]))
        self.assertAlmostEqual(norm, 1.0, places=4)

    def test_multi_face_group_photo_detection(self):
        # 3 faces in group photo
        face_rows = np.array([
            [30, 40, 50, 60, 40, 50, 60, 50, 50, 60, 45, 75, 55, 75, 0.92],
            [120, 40, 50, 60, 130, 50, 150, 50, 140, 60, 135, 75, 145, 75, 0.89],
            [210, 40, 50, 60, 220, 50, 240, 50, 230, 60, 225, 75, 235, 75, 0.94],
        ], dtype=np.float32)

        mock_det = MockDetector(faces_to_return=face_rows)
        mock_rec = MockRecognizer(vector_dim=128)
        engine = BiometricEngine(detector=mock_det, recognizer=mock_rec)

        embeddings = engine.extract_face_embeddings(self.test_jpeg)
        self.assertEqual(len(embeddings), 3)

        for i, item in enumerate(embeddings):
            self.assertEqual(item["faceIndex"], i)
            self.assertEqual(len(item["embedding"]), 128)
            norm = np.linalg.norm(np.array(item["embedding"]))
            self.assertAlmostEqual(norm, 1.0, places=4)

    def test_query_selfie_exactly_one_face_policy(self):
        # Case 1: 0 faces -> NO_FACE_DETECTED
        engine_zero = BiometricEngine(detector=MockDetector(faces_to_return=None), recognizer=MockRecognizer())
        with self.assertRaises(ValueError) as ctx1:
            engine_zero.process_query_selfie(self.test_jpeg)
        self.assertIn("NO_FACE_DETECTED", str(ctx1.exception))

        # Case 2: >1 faces -> MULTIPLE_FACES_DETECTED
        multi_faces = np.array([
            [30, 40, 50, 60, 40, 50, 60, 50, 50, 60, 45, 75, 55, 75, 0.92],
            [120, 40, 50, 60, 130, 50, 150, 50, 140, 60, 135, 75, 145, 75, 0.89],
        ], dtype=np.float32)
        engine_multi = BiometricEngine(detector=MockDetector(faces_to_return=multi_faces), recognizer=MockRecognizer())
        with self.assertRaises(ValueError) as ctx2:
            engine_multi.process_query_selfie(self.test_jpeg)
        self.assertIn("MULTIPLE_FACES_DETECTED", str(ctx2.exception))

        # Case 3: Exactly 1 face -> Success with 128-D vector
        single_face = np.array([
            [60, 70, 100, 120, 80, 90, 120, 90, 100, 110, 90, 140, 110, 140, 0.98]
        ], dtype=np.float32)
        engine_single = BiometricEngine(detector=MockDetector(faces_to_return=single_face), recognizer=MockRecognizer())
        res = engine_single.process_query_selfie(self.test_jpeg)

        self.assertEqual(len(res["embedding"]), 128)
        self.assertAlmostEqual(np.linalg.norm(np.array(res["embedding"])), 1.0, places=4)
        self.assertEqual(res["confidence"], 0.98)
        self.assertEqual(res["modelName"], "MockSFace")

    def test_dimension_and_nan_rejection(self):
        single_face = np.array([
            [60, 70, 100, 120, 80, 90, 120, 90, 100, 110, 90, 140, 110, 140, 0.98]
        ], dtype=np.float32)

        # Dimension mismatch (e.g. 512-D instead of 128-D)
        engine_wrong_dim = BiometricEngine(
            detector=MockDetector(faces_to_return=single_face),
            recognizer=MockRecognizer(vector_dim=512)
        )
        engine_wrong_dim.recognizer._dim = 128  # Expects 128 but returns 512
        engine_wrong_dim.recognizer.extract_feature = lambda al: np.ones((1, 512), dtype=np.float32)

        with self.assertRaises(ValueError) as ctx_dim:
            engine_wrong_dim.extract_face_embeddings(self.test_jpeg)
        self.assertIn("unexpected embedding dimension", str(ctx_dim.exception))

        # NaN rejection
        engine_nan = BiometricEngine(
            detector=MockDetector(faces_to_return=single_face),
            recognizer=MockRecognizer(vector_dim=128, produce_nan=True)
        )
        with self.assertRaises(ValueError) as ctx_nan:
            engine_nan.extract_face_embeddings(self.test_jpeg)
        self.assertIn("NaN or Inf", str(ctx_nan.exception))


if __name__ == "__main__":
    unittest.main()
