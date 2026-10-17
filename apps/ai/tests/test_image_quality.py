import unittest
import numpy as np
import cv2
import os
import sys

# Ensure apps/ai directory is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from biometrics import BiometricEngine
from config import settings


def create_synthetic_face_image(
    w=400, h=400, face_cx=200, face_cy=200, face_scale=1.0,
    brightness=1.0, blur=0, glasses=False, multiple_faces=1,
    noise=0.0
) -> bytes:
    """Generates synthetic image with specified facial parameters and quality conditions."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = (45, 45, 50)

    for i in range(multiple_faces):
        cx = face_cx if multiple_faces == 1 else int(w * (i + 1) / (multiple_faces + 1))
        cy = face_cy

        bw, bh = int(60 * face_scale), int(85 * face_scale)
        skin_color = (int(160 * brightness), int(180 * brightness), int(220 * brightness))
        cv2.ellipse(img, (cx, cy), (bw, bh), 0, 0, 360, skin_color, -1)

        # Hair
        cv2.ellipse(img, (cx, cy - int(45 * face_scale)), (bw + 5, int(50 * face_scale)), 0, 180, 360, (20, 20, 25), -1)

        # Eyes
        eye_y = cy - int(12 * face_scale)
        lx = cx - int(24 * face_scale)
        rx = cx + int(24 * face_scale)
        cv2.circle(img, (lx, eye_y), max(2, int(8 * face_scale)), (240, 240, 240), -1)
        cv2.circle(img, (rx, eye_y), max(2, int(8 * face_scale)), (240, 240, 240), -1)
        cv2.circle(img, (lx, eye_y), max(1, int(4 * face_scale)), (30, 20, 10), -1)
        cv2.circle(img, (rx, eye_y), max(1, int(4 * face_scale)), (30, 20, 10), -1)

        # Nose
        cv2.line(img, (cx, eye_y + 4), (cx, cy + int(12 * face_scale)), (100, 120, 160), 2)

        # Mouth
        cv2.ellipse(img, (cx, cy + int(36 * face_scale)), (int(18 * face_scale), int(7 * face_scale)), 0, 0, 180, (60, 50, 140), -1)

        # Glasses
        if glasses:
            cv2.circle(img, (lx, eye_y), int(15 * face_scale), (200, 200, 200), 2)
            cv2.circle(img, (rx, eye_y), int(15 * face_scale), (200, 200, 200), 2)
            cv2.line(img, (lx + int(15 * face_scale), eye_y), (rx - int(15 * face_scale), eye_y), (200, 200, 200), 2)

    if noise > 0:
        gauss = np.random.normal(0, noise * 255, img.shape).astype(np.int16)
        img = np.clip(img.astype(np.int16) + gauss, 0, 255).astype(np.uint8)

    if blur > 1:
        k = blur if blur % 2 == 1 else blur + 1
        img = cv2.GaussianBlur(img, (k, k), 0)

    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


class TestImageQualityEvaluation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = BiometricEngine.get_instance()

    def test_scenario_01_single_visible_face(self):
        """Scenario 1: One clearly visible face."""
        img = create_synthetic_face_image(400, 400, face_scale=1.0)
        faces = self.engine.detect_faces(img)
        self.assertGreaterEqual(len(faces), 1)
        self.assertGreaterEqual(faces[0]["confidence"], 0.65)

    def test_scenario_02_group_photo_multiple_faces(self):
        """Scenario 2: Multiple people in a group photograph."""
        img = create_synthetic_face_image(800, 400, multiple_faces=3, face_scale=0.85)
        faces = self.engine.detect_faces(img, min_confidence=0.50)
        self.assertGreaterEqual(len(faces), 1)

    def test_scenario_03_small_faces_wide_angle(self):
        """Scenario 3: Small faces in wide-angle photographs."""
        img = create_synthetic_face_image(1200, 800, face_scale=0.45)
        faces = self.engine.detect_faces(img, min_confidence=0.50)
        # SFace/YuNet can detect small faces when resolution is preserved
        self.assertIsInstance(faces, list)

    def test_scenario_04_faces_at_different_angles(self):
        """Scenario 4: Faces at different angles (offset center)."""
        img = create_synthetic_face_image(400, 400, face_cx=140, face_cy=240, face_scale=1.0)
        faces = self.engine.detect_faces(img)
        self.assertGreaterEqual(len(faces), 1)

    def test_scenario_05_low_light_images(self):
        """Scenario 5: Low-light images (low brightness)."""
        img = create_synthetic_face_image(400, 400, brightness=0.45)
        # Should execute safely without crashing
        faces = self.engine.detect_faces(img, min_confidence=0.40)
        self.assertIsInstance(faces, list)

    def test_scenario_06_bright_or_backlit_images(self):
        """Scenario 6: Bright or backlit images."""
        img = create_synthetic_face_image(400, 400, brightness=1.35)
        faces = self.engine.detect_faces(img, min_confidence=0.50)
        self.assertIsInstance(faces, list)

    def test_scenario_07_blurry_photographs(self):
        """Scenario 7: Blurry photographs (Gaussian blur)."""
        img = create_synthetic_face_image(400, 400, blur=7)
        # Blurry photos may degrade confidence but must not raise unexpected errors
        faces = self.engine.detect_faces(img, min_confidence=0.40)
        self.assertIsInstance(faces, list)

    def test_scenario_08_partial_occlusion(self):
        """Scenario 8: Partial occlusion (hand/object covering part of face)."""
        arr = np.frombuffer(create_synthetic_face_image(400, 400), dtype=np.uint8)
        decoded = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        # Draw occlusion box over chin/mouth
        cv2.rectangle(decoded, (160, 220), (240, 270), (45, 45, 50), -1)
        _, buf = cv2.imencode(".jpg", decoded)
        faces = self.engine.detect_faces(buf.tobytes(), min_confidence=0.40)
        self.assertIsInstance(faces, list)

    def test_scenario_09_faces_wearing_glasses(self):
        """Scenario 9: Faces wearing glasses."""
        img = create_synthetic_face_image(400, 400, glasses=True)
        faces = self.engine.detect_faces(img)
        self.assertGreaterEqual(len(faces), 1)

    def test_scenario_10_low_resolution_selfies(self):
        """Scenario 10: Low-resolution selfie (160x160)."""
        img = create_synthetic_face_image(160, 160, face_cx=80, face_cy=80, face_scale=0.5)
        faces = self.engine.detect_faces(img, min_confidence=0.40)
        self.assertIsInstance(faces, list)

    def test_scenario_11_images_without_any_faces(self):
        """Scenario 11: Images without any faces (landscape / solid color)."""
        scenery = np.full((300, 300, 3), (80, 140, 60), dtype=np.uint8)
        # Draw trees/lines
        cv2.line(scenery, (0, 150), (300, 150), (50, 100, 40), 5)
        _, buf = cv2.imencode(".jpg", scenery)
        faces = self.engine.detect_faces(buf.tobytes())
        self.assertEqual(len(faces), 0)

    def test_scenario_12_corrupt_or_unsupported_files(self):
        """Scenario 12: Corrupt or unsupported files."""
        corrupt_bytes = b"NOT_A_VALID_JPEG_HEADER_RANDOM_GARBAGE"
        with self.assertRaises(ValueError):
            self.engine.detect_faces(corrupt_bytes)

    def test_scenario_13_extremely_large_image_dimensions(self):
        """Scenario 13: Extremely large image dimensions (> 50MP ceiling)."""
        # Create small payload that claims huge dimensions or mock shape
        # decode_image verifies: w * h > settings.MAX_IMAGE_PIXELS
        huge_img = np.zeros((100, 100, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", huge_img)
        # Temporarily lower ceiling to test enforcement
        orig_max = settings.MAX_IMAGE_PIXELS
        try:
            settings.MAX_IMAGE_PIXELS = 5000 # 5000 pixels ceiling
            with self.assertRaises(ValueError) as ctx:
                self.engine.detect_faces(buf.tobytes())
            self.assertIn("exceed maximum pixel ceiling", str(ctx.exception))
        finally:
            settings.MAX_IMAGE_PIXELS = orig_max

    def test_scenario_14_portrait_and_landscape_orientations(self):
        """Scenario 14: Portrait (400x600) and landscape (600x400) orientations."""
        portrait = create_synthetic_face_image(400, 600, face_cx=200, face_cy=280)
        landscape = create_synthetic_face_image(600, 400, face_cx=300, face_cy=200)

        p_faces = self.engine.detect_faces(portrait)
        l_faces = self.engine.detect_faces(landscape)

        self.assertGreaterEqual(len(p_faces), 1)
        self.assertGreaterEqual(len(l_faces), 1)

    def test_scenario_15_query_selfie_exactly_one_face_policy(self):
        """Scenario 15: Query selfie enforces exactly-one-face policy."""
        # 1. Zero faces -> ValueError with NO_FACE_DETECTED
        scenery = np.full((300, 300, 3), (80, 140, 60), dtype=np.uint8)
        _, s_buf = cv2.imencode(".jpg", scenery)
        with self.assertRaises(ValueError) as ctx:
            self.engine.process_query_selfie(s_buf.tobytes())
        self.assertIn("NO_FACE_DETECTED", str(ctx.exception))

        # 2. Single face -> extracts 128-D embedding
        single = create_synthetic_face_image(400, 400, face_scale=1.0)
        res = self.engine.process_query_selfie(single)
        self.assertEqual(len(res["embedding"]), 128)
        self.assertEqual(res["modelName"], "SFace")
        self.assertEqual(res["modelVersion"], "v1")
        self.assertAlmostEqual(float(np.linalg.norm(res["embedding"])), 1.0, places=3)


if __name__ == "__main__":
    unittest.main()
