# Smart Room Interface — Project Description

## Overview

A web experience centered on a Three.js particle avatar: a swirling, multicolored cloud of points that can materialize into the loose form of a digital face. That face is the voice and presence of a chatbot that can see the room through the computer’s camera, identify objects with computer vision (OpenCV + TensorFlow.js), converse about what it finds, and download those identifications as a CSV dataset.

## Vision

The avatar lives as motion first — particles in constant swirl — until it is addressed. Once awake, it can hold a conversation. When asked what it sees, it describes everything identifiable in the camera’s field of view, stores those detections, and can export them as a downloadable dataset.

## Core Capabilities (Target)

| Capability | Description |
|---|---|
| **Particle avatar** | GPU-driven Three.js particles that swirl and morph into a face |
| **Wake / attention** | Avatar stays in swirl until it hears **"hello smart room"**; dismiss with **"goodbye smart room"** |
| **Conversation** | Spoken replies via browser TTS when asked what it sees |
| **Room vision** | Webcam + COCO-SSD objects + OpenCV HSV shirt/hair color |
| **Scene reporting** | Spoken/textual description of detected objects and colors |
| **Dataset export** | Log detections locally; **"download dataset"** saves a CSV |

## Technical Direction

### Front-end / WebGL

- Drive particle motion and morphing on the GPU with custom shaders (`ShaderMaterial`), not per-particle CPU objects.
- Maintain two position buffers: loose swirl/cloud positions and face-target positions sampled from a 3D face mesh.
- Interpolate in the vertex shader with a morph progress uniform (`uMorph`: `0` = swirl, `1` = face).

### Vision & speech

- `navigator.mediaDevices.getUserMedia()` for the webcam preview.
- **TensorFlow.js COCO-SSD** (CPU backend) for common object labels — avoids WebGL conflicts with the particle avatar.
- **OpenCV-style HSV** color sampling on shirt / hair regions of a detected person.
- `window.speechSynthesis` for spoken replies.
- In-memory detection log → CSV download on voice command.

## Build Approach

This is a large class project. Work proceeds **one step at a time**.

### Step 1 — Particle swirl → face ✅

- White background
- Multicolored spectral particles
- Continuous swirl animation
- Morph into a face sampled from the **Lee Perry-Smith** head scan (`.glb`)

### Step 2 — Voice wake / sleep ✅

- Continuous Web Speech API listening
- **"hello smart room"** → materialize face
- **"goodbye smart room"** → return to swirl
- Click still works as a fallback

### Step 3 — Camera + object detection ✅

- Webcam via `getUserMedia`
- COCO-SSD object detection on the **CPU** backend (so TensorFlow does not steal Three.js’s WebGL context)
- OpenCV-style HSV sampling for shirt / hair color

### Step 4 — Vision → speech + dataset ✅

- **"what do you see"** → analyze frame, speak summary, log rows
- **"download dataset"** → CSV download (`timestamp`, `object`, `confidence`, `color`)

### Later steps (planned)

5. Richer chat beyond vision commands
6. On-screen visualization of the detection dataset

## Status

**Current focus:** Steps 3–4 complete — camera vision, spoken scene reports, CSV dataset download.
