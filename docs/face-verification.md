# Face identity verification evaluation

## Status and safety boundary

This is an evaluation component, not attendance software. It runs only for an
authenticated, Google-verified student, stores a face reference only after
explicit consent, and does not create attendance records. The result is
never production-verified with the included configuration because no
presentation-attack/liveness model is configured. A face identity match
therefore remains `pending_review`.

The institution has not approved biometric collection, retention, access,
appeals, or an alternative-verification policy in this repository. Do not use
real student biometric data or deploy this component for institutional
decisions until those policies and consent are approved.

## Repository fit and architecture

- `public/js/face-verification.js` exposes `FaceVerification.mount(container,
  options)` and `FaceVerification.destroy()`. It owns camera lifecycle,
  detection polling, consent, sample capture, and result rendering.
- `server/routes/face-verification.js` uses the existing JWT middleware and
  MongoDB connection. The identity always comes from the verified JWT and
  user document; client-supplied user IDs are ignored.
- `inference/app` is a local FastAPI/OpenCV service. The Node service calls it
  with a shared secret; only Node exposes the authenticated application API.
  Models are loaded once at service startup.

Python is used only for inference because OpenCV's YuNet detector and SFace
`FaceRecognizerSF` APIs provide a directly compatible five-landmark
alignment/embedding path. Node remains responsible for authentication,
authorization, encrypted template storage, rate limits, and policy. This
keeps the existing website and authentication architecture in place.

## Models and preprocessing

The model files are pinned to OpenCV Zoo repository revision
[`47534e27c9851bb1128ccc0102f1145e27f23f98`](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98).

| Stage | Model | Verified source information | Implementation |
| --- | --- | --- | --- |
| Detection | YuNet `face_detection_yunet_2023mar.onnx` | [Model README](https://github.com/opencv/opencv_zoo/blob/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/README.md) says files in that model directory are MIT licensed. | OpenCV `FaceDetectorYN`; detection threshold defaults to 0.9 (configurable), NMS is 0.3, top-K is 5000. Five landmarks are checked for finite values. |
| Recognition | SFace `face_recognition_sface_2021dec.onnx` | [Model README](https://github.com/opencv/opencv_zoo/blob/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/README.md) says files in that model directory are Apache-2.0 licensed. | OpenCV `FaceRecognizerSF.alignCrop` performs the model-compatible five-point alignment; `feature` produces a checked 128-value embedding. |

The OpenCV Zoo model examples decode with `cv2.imread` (BGR) and pass the
detected face row, excluding the detector confidence field, to SFace's
`alignCrop`. This service likewise decodes JPEG as BGR and uses OpenCV's
alignment and feature APIs without a separate, guessed color conversion,
resize, or normalization step. The resulting finite, non-zero embedding is
L2-normalized before leaving the inference process. Each stored reference
records the model/preprocessing version, and comparisons reject version
mismatches. The threshold remains configurable as a cosine threshold in
`[-1, 1]`; `.363` in the example environment is the value shown by the OpenCV
Zoo SFace sample, **not a threshold validated for IIIT Dharwad users**.

The YuNet configuration rejects zero or multiple faces, faces below the
configurable 96-pixel minimum width/height, low-confidence detections, and
invalid landmarks. This is a narrow input-quality gate, not a full blur,
illumination, pose, or fairness assessment. It does not identify a person or
establish liveness.

No separate liveness model or authorized presentation-attack evaluation
data is present. `inference/app/liveness.py` therefore returns only
`inconclusive` / `LIVENESS_UNAVAILABLE`. Blinks, movement, or face detection
are not treated as anti-spoof signals. The API result cannot become
`verified` without a future validated liveness integration and calibrated
threshold flags; even then this component does not make attendance decisions.

## Installation and startup

From the repository root in PowerShell:

```powershell
.\inference\download-models.ps1
Set-Location .\inference
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Set the same strong random `FACE_SERVICE_TOKEN` in `server/.env` and
`inference/.env`. Generate it with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Set `FACE_TEMPLATE_ENCRYPTION_KEY` in `server/.env` to a different
32-byte/64-hex random value, generated with the same command. Back up the
encryption key securely: without it MongoDB templates cannot be decrypted.
Keep both environment files out of source control.

Start the inference service from the `inference` directory in one terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Start the existing Node server from `server` in another terminal:

```powershell
npm install
npm start
```

The browser needs camera permission and a secure context (`localhost` works
for development; deployed use requires HTTPS). The inference API binds only
to loopback by default. Do not expose it to the public internet.

If either ONNX file is absent or cannot be loaded, the inference service
reports `ready: false` at `/health`, and the application returns an explicit
model-unavailable response. It does not switch to a different model.

## Reuse and UI integration

The component is loaded on the student welcome page after the current-user
request confirms the authenticated role. It is not mounted for teacher
accounts. Another page can mount it into its own empty container:

```html
<div id="identity-check"></div>
<link rel="stylesheet" href="/css/face-verification.css">
<script src="/js/face-verification.js"></script>
<script>
  const faceCheck = FaceVerification.mount(
    document.getElementById('identity-check'),
    { onStatusChange: ({ state, message }) => console.info(state, message) }
  );
  // On page teardown:
  FaceVerification.destroy();
</script>
```

The module destroys any existing instance before mounting another, removes
its event listeners, aborts pending fetches, and stops all camera tracks.
The user must load enrollment state and check the consent box before the
**Start camera** control is enabled. This consent covers temporary preview
frames as well as the selected enrollment or comparison. Unchecking it stops
the camera and prevents further requests; a request already sent may finish
processing. JPEG frames travel through Node to the local inference service
and are not persisted. Detection requests are sampled every 2.2 seconds; no
continuous video stream is sent.

## Node API contract

Every route requires `Authorization: Bearer <JWT>` and a current MongoDB user
whose `isVerified` is true and role is `student`. A request parameter cannot
select another user's reference. JPEG uploads are held in memory for the
request, are limited to 2 MiB each, and are not written to disk or logged.
Preview is limited to 30 requests/minute, verification to 5/15 minutes,
enrollment to 3/hour, and deletion to 5/hour per user. These limits are
in-process and must be replaced with shared storage before multi-instance
production use.

| Method and path | Request | Success response / behavior |
| --- | --- | --- |
| `GET /api/face-verification/enrollment` | JWT | `{ success, enrolled, modelVersion, consentedAt }`; never includes the template. |
| `POST /api/face-verification/preview` | Multipart JPEG field `capture` and `consent=true` | `{ success, state, bounds, image, latencyMs }`; `state` is `no_face`, `multiple_faces`, `quality_insufficient`, or `ready`. |
| `POST /api/face-verification/enrollment` | Multipart JPEG fields `samples` (2–3) and `consent=true` | Saves an averaged, AES-256-GCM-encrypted template for the JWT user and returns `{ success, enrolled, modelVersion, consentedAt, livenessStatus, reasonCode }`. |
| `POST /api/face-verification/verify` | Multipart JPEG field `capture` and `consent=true` | `{ success, identityStatus, livenessStatus, faceQuality, verificationStatus, modelVersion, reasonCode, latencyMs }`. No score or embedding is returned. |
| `DELETE /api/face-verification/enrollment` | JWT | Deletes only the current user's template and returns `{ success, deleted }`. |

Verification states are `match`, `no_match`, or `inconclusive` for identity;
`pass`, `fail`, or `inconclusive` for liveness; and `verified`,
`not_verified`, or `pending_review` overall. Relevant reason codes include
`NO_ENROLLED_REFERENCE`, `NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`,
`FACE_QUALITY_INSUFFICIENT`, `IDENTITY_NOT_MATCHED`,
`LIVENESS_NOT_PASSED`, `LIVENESS_UNAVAILABLE`,
`MODEL_SERVICE_UNAVAILABLE`, `MODEL_VERSION_MISMATCH`,
`MATCH_THRESHOLD_UNCONFIGURED`, and `RATE_LIMITED`. A missing or unavailable
signal never becomes a positive result.

The service-to-service endpoints are protected by `FACE_SERVICE_TOKEN`.
They accept JPEG bytes only and are bound to `127.0.0.1` in the provided run
command. The Python service returns an embedding only to Node; the browser
does not receive embeddings, scores, or the match threshold. Enrollment and
verification events store the authenticated user, action, identity, liveness,
and overall verification statuses, reason, model version, and timestamp
only—never image data, embeddings, or similarity scores.

## Tests and evaluation

From `server`:

```powershell
npm test
```

From `inference` after installing dependencies:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Unit tests use synthetic vectors/images and fake detections. They establish
input validation and failure behavior only; they are **not** evidence of
real-world recognition accuracy or anti-spoof effectiveness. No authorized
population-specific validation dataset is included, so false acceptance,
false rejection, spoof detection, demographic performance, and production
latency are not measured. YuNet/SFace upstream benchmark figures are not
adopted as results for this application.

## Required work before production

1. Obtain institutional approval for biometric processing, consent, access,
   alternatives, retention, deletion, audit, and appeals.
2. Evaluate genuine and impostor comparisons on a representative,
   consented dataset; calibrate and independently review the threshold.
3. Select and validate a separate presentation-attack/liveness model against
   printed photos, screen photos, replayed video, and relevant campus attacks.
4. Replace in-memory rate limits with a shared limiter, add production
   monitoring and key rotation/backup procedures, and deploy both services
   behind approved TLS/network controls.
5. Integrate this evidence with a separately implemented attendance backend
   that also verifies session eligibility, location, trusted-network
   evidence, duplicate attempts, and review policy.
