# ADR-015: Face Embedding Model Selection & Vector Storage Architecture

## Status
Accepted

## Context
In Phase 14, the platform integrated the neural face detector **OpenCV YuNet** to detect multiple faces, output normalized bounding boxes $[x, y, w, h] \in [0, 1]$, and extract 5 facial landmarks (right eye, left eye, nose tip, right mouth corner, left mouth corner).

In Phase 15, the platform must convert these detected facial regions into compact, highly discriminative numerical vector embeddings, validate the vectors, and persist them in PostgreSQL using `pgvector`. In Phase 16, guest selfie searches will query these vectors to match attendees across both solo portraits and multi-person group photographs.

We must select a model that is:
1. Highly accurate at face verification across diverse wedding/event lighting, expressions, and poses.
2. Lightweight enough to run offline on CPU without requiring expensive GPU infrastructure.
3. Permissively licensed for commercial use (both the software runtime and pretrained model weights).
4. Native to the existing OpenCV DNN execution environment established in Phase 14.

---

## Decision

We select **OpenCV SFace** (`face_recognition_sface_2021dec.onnx`) running via the OpenCV DNN engine in the dedicated Python microservice (`apps/ai`).

### 1. Model Specifications & Output Contract
- **Model Name & File:** `OpenCV SFace (face_recognition_sface_2021dec.onnx)` from the official OpenCV Model Zoo.
- **Model Size:** 38.6 MB (compact, fast startup, low RAM footprint).
- **Architecture:** SphereFace / MobileFaceNet variant optimized for mobile and CPU inference.
- **Embedding Dimension:** **128 dimensions** (`vector(128)`).
- **Numeric Data Type:** 32-bit floating point (`float32`), serialized as a 128-element array.
- **Normalization:** L2 unit-norm ($\|v\|_2 = 1.0$). The SFace feature extractor produces unit-length vectors; the service explicitly re-verifies and normalizes $\hat{v} = v / \|v\|_2$.
- **Required Input Crop:** $112 \times 112$ pixels, aligned via similarity transformation.
- **Distance Metric:** **Cosine Distance** ($d = 1 - \text{cosine similarity}$), implemented in PostgreSQL pgvector via the `<=>` operator.
- **Calibrated Verification Threshold:**
  - Standard SFace benchmark threshold: Cosine similarity $\ge 0.637$ (Cosine distance $\le 0.363$) achieves False Acceptance Rate (FAR) $\le 0.001$.

### 2. Alignment & Preprocessing Pipeline
1. **Source Image:** Ingests source photograph buffer (JPEG, PNG, or WebP) decoded into BGR numpy array.
2. **Alignment (`alignCrop`):** Utilizes `cv2.FaceRecognizerSF.alignCrop(img, face)`. This warps and crops the face using the 5 facial landmarks detected by YuNet in Phase 14 to center the eyes and mouth at standardized coordinates.
3. **Feature Extraction:** `recognizer.feature(aligned_face)` extracts the 128-D vector.
4. **Vector Validation:**
   - Enforces exact length of 128 elements.
   - Asserts all values are finite (`np.isfinite`, rejecting `NaN`, `null`, `Infinity`).
   - Asserts unit norm ($0.95 \le \|v\|_2 \le 1.05$).

### 3. Licensing & Commercial Permissibility
- **Runtime Library:** OpenCV (`opencv-python-headless`) is licensed under **Apache 2.0**.
- **Model Weights:** `face_recognition_sface_2021dec.onnx` is hosted in the official OpenCV Zoo under **Apache 2.0** / **BSD-3-Clause**.
- **Commercial Permissibility:** Unlike InsightFace ArcFace models (which are frequently distributed under CC-BY-NC-4.0 non-commercial restrictions), SFace weights are completely free of non-commercial clauses and are 100% authorized for commercial photography SaaS deployment.

### 4. Hardware & Resource Profile
- **Inference Latency:** 35–55 ms per face on modern multicore x86_64 / ARM64 CPUs.
- **Memory Footprint:** Model weights occupy ~40 MB RAM in worker memory; total process overhead < 150 MB.
- **Warmth:** Loaded once on FastAPI startup in `BiometricEngine.get_instance()`; zero per-image disk I/O or cold-start overhead.

### 5. PostgreSQL Schema & pgvector Design
- Stored in the dedicated `face_embeddings` table:
  ```sql
  CREATE TABLE face_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      photo_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      face_index INT NOT NULL DEFAULT 0 CHECK (face_index >= 0),
      box_x REAL NOT NULL,
      box_y REAL NOT NULL,
      box_w REAL NOT NULL,
      box_h REAL NOT NULL,
      confidence REAL NOT NULL,
      model_name VARCHAR(100) NOT NULL DEFAULT 'SFace',
      model_version VARCHAR(50) NOT NULL DEFAULT 'v1',
      embedding vector(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **HNSW Indexing:**
  `CREATE INDEX idx_face_embeddings_hnsw ON face_embeddings USING hnsw (embedding vector_cosine_ops);`
- **Cascade Purge:** Foreign keys with `ON DELETE CASCADE` from both `events` and `media` ensure that deleting a photo or event automatically cleans up all associated vectors without orphaned data.

### 6. Model Upgrades & Migration Strategy
- `model_name` and `model_version` fields tag every stored vector.
- If a future model is introduced (e.g. SFace v2), queries can filter `WHERE model_name = 'SFace' AND model_version = 'v1'` to prevent mixing incompatible vector spaces.
- Photos can be re-indexed asynchronously using Phase 13 queue jobs without downtime.

---

## Alternatives Considered

1. **InsightFace ArcFace (ResNet-50 / Glint360k):**
   - *Pros:* State-of-the-art accuracy on LFW and MegaFace benchmarks (512-D vectors).
   - *Cons:* Pretrained model weights are distributed under non-commercial licenses (**CC-BY-NC-4.0**), posing critical legal and copyright infringement risks for a commercial photography product. Requires heavy memory (300 MB+) and significantly higher CPU latency.
2. **FaceNet (Inception-ResNet-v1 / 512-D):**
   - *Pros:* Popular open-source reference.
   - *Cons:* 512-dimensional embeddings double database vector index size; significantly slower CPU inference (150–250 ms); requires TensorFlow or PyTorch runtime dependency (over 1.5 GB package installation).
3. **dlib ResNet Face Recognition:**
   - *Pros:* Established Python library.
   - *Cons:* Requires complex C++ CMake build tools; prone to binary wheel build failures in CI/CD and deployment environments; slower than OpenCV DNN runtime.

---

## Consequences

- **Positive:** Extremely fast CPU inference (sub-50ms), compact 128-D vector representation, native OpenCV integration, 100% commercially permissive licensing, seamless compatibility with pgvector HNSW indexing.
- **Negative:** Lower discriminative resolution on extreme profile views (>60° yaw) or heavily occluded faces compared to 512-D ResNet models; mitigated by setting calibrated confidence and distance thresholds.
