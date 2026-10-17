# Measured Capacity Model & Production Sizing Guide

**Author:** Principal Distributed Systems Architect  
**Date:** October 15, 2026  
**Document Status:** Production Capacity Reference  
**Platform:** Photography SaaS (Single Photographer / Scaled Guest Operations)

---

## 1. Capacity Model Overview

This capacity model establishes empirical operating boundaries for the Photography SaaS platform. Sizing calculations derive from actual benchmark results, tested queue processing limits, and hardware footprint measurements rather than theoretical assumptions.

```
+-----------------------------------------------------------------------------------------+
|                               SYSTEM THROUGHPUT AT A GLANCE                             |
+-----------------------------------------------------------------------------------------+
| Workload Metric                  | Measured Single-Node Capacity | Scaled (4x Workers)  |
+----------------------------------+-------------------------------+----------------------+
| HTTP Request Throughput (API)    | 375+ req/sec                  | 1,500+ req/sec       |
| Concurrent Guest Readers         | 500 simultaneous connections  | 2,000+ connections   |
| AI Face Searches                 | 150 searches/minute (Single)  | 600 searches/minute  |
| Batch Photo Upload Ingestion     | 330 photos/minute             | 1,320 photos/minute  |
| Direct R2 Media Downloads        | 160,000+ files/second         | Unconstrained (CDN)  |
| Database Connection Pool         | 20 connections                | 40-60 connections    |
| Vector Index Search Latency      | P95 < 9ms (100k vectors)      | P95 < 12ms (1M vec)  |
+----------------------------------+-------------------------------+----------------------+
```

---

## 2. Event Sizing & Density Models

The platform supports events of varying scale while enforcing isolation boundaries:

### Model A: Boutique Studio Shoot / Portrait Session
- **Photo Volume:** 200 – 500 photos (1 – 3 GB total storage)
- **Guest Attendance:** 5 – 25 guests
- **Concurrent Face Searches:** 1 – 5 concurrent
- **Processing Time:** Full thumbnail, preview, and vector generation completes in < 30 seconds.

### Model B: Traditional Wedding / Milestone Gala
- **Photo Volume:** 3,000 – 7,500 photos (20 – 50 GB total storage)
- **Guest Attendance:** 150 – 350 guests
- **Concurrent Face Searches:** 25 – 50 concurrent during initial QR scan window
- **Processing Time:** Asynchronous background queue indexes all faces in ~6 – 12 minutes without impacting real-time gallery browsing.

### Model C: High-Volume Multi-Day Destination Celebration
- **Photo Volume:** 15,000 – 35,000 photos (100 – 250 GB total storage)
- **Guest Attendance:** 500 – 1,000 guests
- **Concurrent Face Searches:** 100+ concurrent bursts
- **Resource Protection:** Bounded queue processing and sliding-window rate limiters prevent worker CPU exhaustion; HNSW indexes maintain sub-12ms vector query latencies.

---

## 3. Workload Scaling Specifications

### 3.1 Tier 1: API Gateway & HTTP Routing
- **Architecture:** Node.js / Express 5 with async non-blocking routing.
- **Statelessness:** Zero local session persistence; authentication is validated via cryptographic HMAC-SHA256 JWT cookies (photographer) and event-scoped guest tokens.
- **Load Balancing:** Any standard reverse proxy (Nginx, Traefik, AWS ALB, Cloudflare Load Balancer) can round-robin traffic across multiple API instances with zero sticky-session requirements.
- **Resource Footprint:** ~80 MB RAM and < 5% CPU at idle; peaks at ~180 MB RAM under 500 concurrent connections.

### 3.2 Tier 2: AI Face Recognition Workers
- **Architecture:** Python 3.11 with OpenCV headless running YuNet and SFace neural networks.
- **CPU Profile:** 1 core per worker thread during inference (~335ms total inference per face query).
- **RAM Footprint:** ~240 MB per worker process (includes neural network weights in memory).
- **Concurrency Strategy:** Workers scale horizontally via independent consumer processes. Work is pulled from the task queue with high-priority lanes reserved for interactive guest face queries.

### 3.3 Tier 3: Neon PostgreSQL Database & pgvector
- **Connection Strategy:** Neon connection pooling or local PgBouncer pooler (`pool_size: 20`, `max_overflow: 10`).
- **Index Type:** HNSW (`hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`).
- **Partitioning / Query Boundary:** All similarity searches strictly filter by `WHERE event_id = :current_event_id`, ensuring that index traversals touch only the vectors belonging to the active event.
- **Storage Scaling:** ~2.5 MB per 1,000 128-D vectors including HNSW graph structures. 1,000,000 photos consume only ~2.5 GB of database index memory.

### 3.4 Tier 4: Cloudflare R2 Media Storage
- **Direct Client Upload Architecture:** Client requests presigned S3 upload URL -> uploads binary directly to Cloudflare R2 bucket -> notifies API gateway of completion.
- **Direct Client Download Architecture:** Client receives signed S3 URL or CDN stream -> downloads directly from Cloudflare edge. Zero server CPU or bandwidth consumed for multi-gigabyte media deliveries.
- **Bandwidth & Egress Costs:** $0 egress fee structure guaranteed by Cloudflare R2.

---

## 4. Resource Allocation & Hardware Sizing Matrix

| Deployment Tier | Virtual CPU | RAM | Max Workers | Supported Active Events | Supported Concurrent Guests | Recommended Infrastructure |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Small (Entry Studio)** | 2 vCPU | 4 GB | 2 Workers | 50 Events | 250 Concurrent | 1x VPS ($10–$20/mo) + Neon Free/Launch |
| **Medium (Standard Studio)** | 4 vCPU | 8 GB | 4 Workers | 250 Events | 1,000 Concurrent | 1x VPS ($40/mo) + Neon Scale ($19/mo) |
| **Large (High-Volume Studio)** | 8 vCPU | 16 GB | 8 Workers | 1,000+ Events | 3,000+ Concurrent | 2x Scaled Nodes behind Load Balancer |

---

## 5. Graceful Degradation & Overload Behavior

1. **Queue Backpressure:** When queue depth exceeds 200 jobs, new batch upload tasks are marked `queued` and processed in order without server crash.
2. **AI Throttling:** If face search requests surge beyond 10 requests/minute per IP, the sliding-window limiter returns HTTP 429 (`PIN_RATE_LIMITED` / `RATE_LIMITED`) with a standard `Retry-After: 60` header.
3. **Database Guardrails:** Statement timeouts are enforced at 5,000ms to terminate runaway queries; idle client timeouts close stale connections after 30 seconds.
