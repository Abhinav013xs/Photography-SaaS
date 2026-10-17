import sys
import time
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Request, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from biometrics import BiometricEngine

start_time = time.time()
engine: Optional[BiometricEngine] = None

def get_engine() -> BiometricEngine:
    global engine
    if engine is None:
        try:
            engine = BiometricEngine.get_instance()
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Biometric engine unavailable: {str(e)}")
    return engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize biometric models on application startup
    try:
        get_engine()
        print("Biometric models successfully initialized.")
    except Exception as e:
        print(f"Warning: Failed to initialize BiometricEngine on startup: {e}")
    yield

app = FastAPI(
    title="Studio Lumina AI Biometric Inference Service",
    description="Dedicated microservice for neural face detection (YuNet) and 128-D vector extraction (SFace)",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS restricted to trusted local service callers
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_process_time_and_log(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000, 2)
    response.headers["X-Response-Time-Ms"] = str(duration_ms)
    return response

@app.get("/health")
async def health_check():
    """
    Health check endpoint for the Python AI Service.
    Verifies process readiness and reports actual model loading state.
    """
    uptime_seconds = int(time.time() - start_time)
    eng = None
    try:
        eng = get_engine()
    except Exception:
        pass

    models_ready = eng is not None and eng.is_ready
    return {
        "status": "healthy" if models_ready else "degraded",
        "service": "photography-ai-service",
        "version": "1.0.0",
        "uptimeSeconds": uptime_seconds,
        "environment": settings.ENVIRONMENT,
        "pythonVersion": sys.version.split(" ")[0],
        "modelsLoaded": models_ready,
        "detector": "OpenCV YuNet (face_detection_yunet_2023mar.onnx)",
        "recognizer": "OpenCV SFace (face_recognition_sface_2021dec.onnx)",
    }

@app.get("/ready")
async def ready_check():
    """
    Readiness probe confirming neural models, preprocessing, and 128-D embedding pipeline are ready.
    Returns model identifiers, licensing, and expected embedding dimension.
    """
    try:
        eng = get_engine()
        info = eng.get_model_info()
        return {
            "status": "ready",
            "service": "photography-ai-service",
            "version": "1.0.0",
            **info,
        }
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail={"status": "not_ready", "message": f"Biometric engine not ready: {str(e)}"}
        )

@app.post("/detect-faces")
async def detect_faces(
    file: UploadFile = File(...),
    confidence: Optional[float] = Query(None, alias="confidence"),
):
    """
    Detects faces in an image using OpenCV YuNet.
    Returns normalized bounding box coordinates and confidence scores.
    Handles single-face, group photos, and zero-face cases gracefully.
    """
    eng = get_engine()
    image_bytes = await file.read()
    try:
        faces = eng.detect_faces(image_bytes, min_confidence=confidence)
        return {
            "status": "success",
            "faceCount": len(faces),
            "faces": faces,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Face detection inference failed: {str(e)}")

@app.post("/extract-embeddings")
async def extract_embeddings(
    file: UploadFile = File(...),
    confidence: Optional[float] = Query(None, alias="confidence"),
):
    """
    Extracts 128-D L2-normalized biometric face embeddings using OpenCV YuNet + SFace.
    Returns detected faces along with normalized 128-D embedding vectors.
    """
    eng = get_engine()
    image_bytes = await file.read()
    try:
        faces = eng.extract_face_embeddings(image_bytes, min_confidence=confidence)
        return {
            "status": "success",
            "faceCount": len(faces),
            "faces": faces,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Face embedding extraction failed: {str(e)}")

@app.post("/process-query-selfie")
async def process_query_selfie(
    file: UploadFile = File(...),
):
    """
    Processes a guest query selfie for AI face search.
    Enforces strict exactly-one-face policy:
    - 0 faces: returns HTTP 422 with NO_FACE_DETECTED error
    - >1 faces: returns HTTP 422 with MULTIPLE_FACES_DETECTED error
    - 1 face: extracts and returns 128-D L2-normalized vector embedding
    Selfie is processed ephemerally in RAM and immediately garbage collected.
    """
    eng = get_engine()
    image_bytes = await file.read()
    try:
        result = eng.process_query_selfie(image_bytes)
        return {
            "status": "success",
            "face": result,
        }
    except ValueError as ve:
        err_msg = str(ve)
        err_code = "VALIDATION_ERROR"
        if "NO_FACE_DETECTED" in err_msg:
            err_code = "NO_FACE_DETECTED"
        elif "MULTIPLE_FACES_DETECTED" in err_msg:
            err_code = "MULTIPLE_FACES_DETECTED"
        elif "INVALID_FACE_CROP" in err_msg:
            err_code = "INVALID_FACE_CROP"
        elif "ALIGNMENT_FAILED" in err_msg:
            err_code = "ALIGNMENT_FAILED"

        status_code = 422 if err_code in ["NO_FACE_DETECTED", "MULTIPLE_FACES_DETECTED"] else 400
        raise HTTPException(
            status_code=status_code,
            detail={"code": err_code, "message": err_msg},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"code": "INFERENCE_FAILED", "message": f"Query selfie processing failed: {str(e)}"}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, log_level=settings.LOG_LEVEL)

