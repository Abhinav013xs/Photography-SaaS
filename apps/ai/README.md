# Dedicated Python AI Biometric Service

**Classification:** High-Performance AI Inference Daemon  
**Runtime:** Python 3.10+  
**Framework:** FastAPI + Uvicorn  
**Models:** OpenCV YuNet (Face Detection) + SFace (Face Recognition & 128-D Vector Embeddings)  

---

## 1. Overview
This microservice isolates heavy neural network inference from the Node.js application server. It pre-warms deep-learning ONNX models in memory once on startup and provides sub-80ms CPU face detection and 128-D vector extraction over a low-latency local HTTP connection (`127.0.0.1:8000`).

In Phase 2, this directory contains the **minimal service skeleton and health endpoint**; actual neural model loading and inference are implemented in **Phase 14** (Detection) and **Phase 15** (Embeddings).

---

## 2. Setup & Execution

### 2.1 Virtual Environment
```bash
# Create virtual environment
python -m venv .venv

# Activate on Windows PowerShell
.venv\Scripts\Activate.ps1

# Activate on Linux/macOS
source .venv/bin/activate
```

### 2.2 Install Dependencies
```bash
pip install -r requirements.txt
```

### 2.3 Run Development Server
```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 2.4 Verify Health
```bash
curl http://127.0.0.1:8000/health
```
