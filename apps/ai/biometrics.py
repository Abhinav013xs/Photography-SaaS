from abc import ABC, abstractmethod
import os
import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from config import settings


class BaseFaceDetector(ABC):
    """
    Abstract interface for face detection models.
    Permits swapping underlying neural architectures without breaking API or database contracts.
    """

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Name of the detection architecture (e.g. 'YuNet')."""
        pass

    @property
    @abstractmethod
    def model_version(self) -> str:
        """Model checkpoint version identifier."""
        pass

    @property
    @abstractmethod
    def license(self) -> str:
        """Commercial license classification."""
        pass

    @property
    @abstractmethod
    def is_ready(self) -> bool:
        """Readiness state indicator."""
        pass

    @abstractmethod
    def set_input_size(self, size: Tuple[int, int]) -> None:
        """Sets the dynamic input dimensions (width, height) for inference."""
        pass

    @abstractmethod
    def detect(self, img: np.ndarray, min_confidence: Optional[float] = None) -> Tuple[int, Optional[np.ndarray]]:
        """
        Executes face detection on an OpenCV BGR image matrix.
        Returns (status_code, raw_faces_ndarray).
        """
        pass


class YuNetFaceDetector(BaseFaceDetector):
    """
    OpenCV YuNet face detector implementation.
    Model: face_detection_yunet_2023mar.onnx
    License: MIT / Apache 2.0 (Commercially Permissive)
    """

    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"YuNet ONNX model not found at {model_path}")
        self._path = model_path
        self._detector = cv2.FaceDetectorYN.create(
            self._path,
            "",
            (320, 320),
            settings.DETECTION_SCORE_THRESHOLD,
            settings.DETECTION_NMS_THRESHOLD,
            settings.DETECTION_TOP_K,
        )
        self._is_ready = True

    @property
    def model_name(self) -> str:
        return "YuNet"

    @property
    def model_version(self) -> str:
        return "2023mar"

    @property
    def license(self) -> str:
        return "MIT / Apache 2.0 (Commercial Use Permitted)"

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    def set_input_size(self, size: Tuple[int, int]) -> None:
        self._detector.setInputSize(size)

    def detect(self, img: np.ndarray, min_confidence: Optional[float] = None) -> Tuple[int, Optional[np.ndarray]]:
        threshold = min_confidence if min_confidence is not None else settings.DETECTION_SCORE_THRESHOLD
        self._detector.setScoreThreshold(threshold)
        return self._detector.detect(img)


class BaseFaceRecognizer(ABC):
    """
    Abstract interface for face recognition and biometric vector embedding models.
    """

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Name of the recognition architecture (e.g. 'SFace')."""
        pass

    @property
    @abstractmethod
    def model_version(self) -> str:
        """Model checkpoint version identifier."""
        pass

    @property
    @abstractmethod
    def license(self) -> str:
        """Commercial license classification."""
        pass

    @property
    @abstractmethod
    def embedding_dimension(self) -> int:
        """Strict vector dimensionality (e.g. 128)."""
        pass

    @property
    @abstractmethod
    def is_ready(self) -> bool:
        """Readiness state indicator."""
        pass

    @abstractmethod
    def align_crop(self, img: np.ndarray, face: np.ndarray) -> Optional[np.ndarray]:
        """Aligns and crops the face crop using 5-point facial landmark geometry."""
        pass

    @abstractmethod
    def extract_feature(self, aligned_face: np.ndarray) -> np.ndarray:
        """Extracts the dense feature vector from an aligned face crop."""
        pass


class SFaceFaceRecognizer(BaseFaceRecognizer):
    """
    OpenCV SFace face recognizer implementation.
    Model: face_recognition_sface_2021dec.onnx
    Dimensions: 128-D L2-normalized dense float vector
    License: Apache 2.0 / 3-Clause BSD (Commercially Permissive)
    """

    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"SFace ONNX model not found at {model_path}")
        self._path = model_path
        self._recognizer = cv2.FaceRecognizerSF.create(self._path, "")
        self._is_ready = True

    @property
    def model_name(self) -> str:
        return "SFace"

    @property
    def model_version(self) -> str:
        return "v1"

    @property
    def license(self) -> str:
        return "Apache 2.0 / BSD (Commercial Use Permitted)"

    @property
    def embedding_dimension(self) -> int:
        return 128

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    def align_crop(self, img: np.ndarray, face: np.ndarray) -> Optional[np.ndarray]:
        return self._recognizer.alignCrop(img, face)

    def extract_feature(self, aligned_face: np.ndarray) -> np.ndarray:
        return self._recognizer.feature(aligned_face)


class BiometricEngine:
    """
    Production Biometric Engine singleton.
    Coordinates face detection, landmark alignment, and 128-D embedding extraction.
    Models are loaded once on startup and reused for all subsequent inference jobs.
    """
    _instance: Optional["BiometricEngine"] = None

    def __init__(
        self,
        detector: Optional[BaseFaceDetector] = None,
        recognizer: Optional[BaseFaceRecognizer] = None,
    ):
        yunet_path = os.path.join(settings.MODELS_DIR, settings.YUNET_MODEL_FILENAME)
        sface_path = os.path.join(settings.MODELS_DIR, settings.SFACE_MODEL_FILENAME)

        self.detector = detector or YuNetFaceDetector(yunet_path)
        self.recognizer = recognizer or SFaceFaceRecognizer(sface_path)
        self.is_ready = self.detector.is_ready and self.recognizer.is_ready

    @classmethod
    def get_instance(cls) -> "BiometricEngine":
        if cls._instance is None:
            cls._instance = BiometricEngine()
        return cls._instance

    def get_model_info(self) -> Dict[str, Any]:
        """Returns metadata about loaded models, versions, dimensions, and commercial licenses."""
        return {
            "status": "ready" if self.is_ready else "degraded",
            "modelsLoaded": self.is_ready,
            "inferenceDevice": "CPU",
            "detector": {
                "name": self.detector.model_name,
                "version": self.detector.model_version,
                "license": self.detector.license,
                "ready": self.detector.is_ready,
            },
            "recognizer": {
                "name": self.recognizer.model_name,
                "version": self.recognizer.model_version,
                "license": self.recognizer.license,
                "embeddingDimension": self.recognizer.embedding_dimension,
                "ready": self.recognizer.is_ready,
            },
        }

    def decode_image(self, image_bytes: bytes) -> np.ndarray:
        """
        Safely decodes an image buffer into an OpenCV BGR numpy array.
        Enforces binary magic byte verification, pixel limits and validates binary integrity.
        """
        if not image_bytes or len(image_bytes) < 12:
            raise ValueError("Image buffer is too small or empty")

        # Binary magic byte verification
        is_jpeg = len(image_bytes) >= 3 and image_bytes[0] == 0xff and image_bytes[1] == 0xd8 and image_bytes[2] == 0xff
        is_png = len(image_bytes) >= 8 and image_bytes[:8] == b'\x89PNG\r\n\x1a\n'
        is_webp = len(image_bytes) >= 12 and image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP'

        if not (is_jpeg or is_png or is_webp):
            raise ValueError("Corrupt or unsupported image format. Expected valid JPEG, PNG, or WebP.")

        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Corrupt or unsupported image format. Expected valid JPEG, PNG, or WebP.")

        h, w = img.shape[:2]
        if w * h > settings.MAX_IMAGE_PIXELS:
            raise ValueError(f"Image dimensions ({w}x{h}) exceed maximum pixel ceiling.")

        return img

    def detect_faces(self, image_bytes: bytes, min_confidence: Optional[float] = None) -> List[Dict[str, Any]]:
        """
        Detects faces in an image using YuNet.
        Returns normalized bounding box coordinates [box_x, box_y, box_w, box_h] clamped to [0, 1]
        and confidence scores.
        """
        img = self.decode_image(image_bytes)
        h, w = img.shape[:2]

        self.detector.set_input_size((w, h))
        _, raw_faces = self.detector.detect(img, min_confidence=min_confidence)

        results = []
        if raw_faces is None or len(raw_faces) == 0:
            return results

        for idx, face in enumerate(raw_faces):
            # YuNet output: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
            x, y, box_w, box_h = face[0:4]
            confidence = float(face[14])

            # Normalize coordinates to [0, 1] relative to image dimensions
            norm_x = max(0.0, min(1.0, float(x) / w))
            norm_y = max(0.0, min(1.0, float(y) / h))
            norm_w = max(0.001, min(1.0, float(box_w) / w))
            norm_h = max(0.001, min(1.0, float(box_h) / h))

            # Landmarks (5 points: right eye, left eye, nose tip, right mouth corner, left mouth corner)
            landmarks = []
            for i in range(5):
                lx = float(face[4 + i * 2])
                ly = float(face[5 + i * 2])
                landmarks.append({
                    "x": max(0.0, min(1.0, lx / w)),
                    "y": max(0.0, min(1.0, ly / h)),
                })

            results.append({
                "faceIndex": idx,
                "boxX": round(norm_x, 6),
                "boxY": round(norm_y, 6),
                "boxW": round(norm_w, 6),
                "boxH": round(norm_h, 6),
                "confidence": round(confidence, 4),
                "landmarks": landmarks,
            })

        return results

    def extract_face_embeddings(self, image_bytes: bytes, min_confidence: Optional[float] = None) -> List[Dict[str, Any]]:
        """
        Detects faces and extracts 128-dimensional L2-normalized vector embeddings using OpenCV SFace.
        Ensures strict 128-D dimension, finite numeric values, and unit vector normalization.
        """
        img = self.decode_image(image_bytes)
        h, w = img.shape[:2]

        self.detector.set_input_size((w, h))
        _, raw_faces = self.detector.detect(img, min_confidence=min_confidence)

        results = []
        if raw_faces is None or len(raw_faces) == 0:
            return results

        for idx, face in enumerate(raw_faces):
            x, y, box_w, box_h = face[0:4]
            confidence = float(face[14])

            # Align and crop face using SFace recognizer
            aligned_face = self.recognizer.align_crop(img, face)
            if aligned_face is None:
                continue

            # Extract 128-D feature vector
            feature = self.recognizer.extract_feature(aligned_face)

            # Flatten and ensure float32 array
            vector = feature.flatten().astype(np.float32)

            # Check vector length against model specification
            expected_dim = self.recognizer.embedding_dimension
            if len(vector) != expected_dim:
                raise ValueError(f"{self.recognizer.model_name} returned unexpected embedding dimension: {len(vector)} (expected {expected_dim})")

            # Check for finite values
            if not np.all(np.isfinite(vector)):
                raise ValueError("Extracted embedding contains NaN or Inf values")

            # Verify L2 normalization
            norm = float(np.linalg.norm(vector))
            if norm > 0:
                vector = vector / norm

            norm_x = max(0.0, min(1.0, float(x) / w))
            norm_y = max(0.0, min(1.0, float(y) / h))
            norm_w = max(0.001, min(1.0, float(box_w) / w))
            norm_h = max(0.001, min(1.0, float(box_h) / h))

            results.append({
                "faceIndex": idx,
                "boxX": round(norm_x, 6),
                "boxY": round(norm_y, 6),
                "boxW": round(norm_w, 6),
                "boxH": round(norm_h, 6),
                "confidence": round(confidence, 4),
                "modelName": self.recognizer.model_name,
                "modelVersion": self.recognizer.model_version,
                "embedding": [round(float(v), 7) for v in vector],
            })

        return results

    def process_query_selfie(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Processes a guest query selfie for AI face search:
        1. Decodes and validates image format and dimensions.
        2. Detects faces with YuNet.
        3. Enforces the strict EXACTLY-ONE-FACE policy:
           - 0 faces: raises ValueError("NO_FACE_DETECTED: No face detected in selfie. Please submit a clear, well-lit photo of your face.")
           - >1 faces: raises ValueError("MULTIPLE_FACES_DETECTED: Multiple faces detected. Please submit a selfie containing only one person.")
        4. Aligns and crops the single face using SFace recognizer.
        5. Extracts 128-D L2-normalized vector embedding using SFace.
        6. Validates dimension (128), finite numbers, and unit norm.
        Returns the embedding, confidence, and bounding box.
        """
        img = self.decode_image(image_bytes)
        h, w = img.shape[:2]

        self.detector.set_input_size((w, h))
        _, raw_faces = self.detector.detect(img)

        face_count = 0 if raw_faces is None else len(raw_faces)

        if face_count == 0:
            raise ValueError("NO_FACE_DETECTED: No face detected in selfie. Please submit a clear, well-lit photo of your face.")
        elif face_count > 1:
            raise ValueError(f"MULTIPLE_FACES_DETECTED: Multiple faces detected ({face_count}). Please submit a selfie containing only one person.")

        face = raw_faces[0]
        x, y, box_w, box_h = face[0:4]
        confidence = float(face[14])

        if box_w <= 0 or box_h <= 0:
            raise ValueError("INVALID_FACE_CROP: Detected face has invalid dimensions.")

        # Align and crop face using recognizer
        aligned_face = self.recognizer.align_crop(img, face)
        if aligned_face is None:
            raise ValueError("ALIGNMENT_FAILED: Failed to align face for biometric extraction.")

        # Extract 128-D feature vector
        feature = self.recognizer.extract_feature(aligned_face)
        vector = feature.flatten().astype(np.float32)

        expected_dim = self.recognizer.embedding_dimension
        if len(vector) != expected_dim:
            raise ValueError(f"{self.recognizer.model_name} returned unexpected embedding dimension: {len(vector)} (expected {expected_dim})")

        if not np.all(np.isfinite(vector)):
            raise ValueError("Extracted embedding contains NaN or Inf values")

        norm = float(np.linalg.norm(vector))
        if norm > 0:
            vector = vector / norm

        norm_x = max(0.0, min(1.0, float(x) / w))
        norm_y = max(0.0, min(1.0, float(y) / h))
        norm_w = max(0.001, min(1.0, float(box_w) / w))
        norm_h = max(0.001, min(1.0, float(box_h) / h))

        return {
            "confidence": round(confidence, 4),
            "boxX": round(norm_x, 6),
            "boxY": round(norm_y, 6),
            "boxW": round(norm_w, 6),
            "boxH": round(norm_h, 6),
            "modelName": self.recognizer.model_name,
            "modelVersion": self.recognizer.model_version,
            "embedding": [round(float(v), 7) for v in vector],
        }
