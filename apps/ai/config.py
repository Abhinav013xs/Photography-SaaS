import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    LOG_LEVEL: str = "info"
    ENVIRONMENT: str = "development"

    # AI Model Settings
    MODELS_DIR: str = os.path.join(os.path.dirname(__file__), "models")
    YUNET_MODEL_FILENAME: str = "face_detection_yunet_2023mar.onnx"
    SFACE_MODEL_FILENAME: str = "face_recognition_sface_2021dec.onnx"

    # Face Detection Hyperparameters
    DETECTION_SCORE_THRESHOLD: float = 0.65
    DETECTION_NMS_THRESHOLD: float = 0.30
    DETECTION_TOP_K: int = 5000

    # Max image dimensions for inference safety
    MAX_IMAGE_PIXELS: int = 50_000_000

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
