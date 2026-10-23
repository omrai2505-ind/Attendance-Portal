from threading import Lock
from time import perf_counter

import cv2
import numpy as np

from .config import Settings


class PipelineError(Exception):
    def __init__(self, reason_code: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code


def decode_image(raw: bytes, settings: Settings) -> np.ndarray:
    if not raw or len(raw) > settings.maximum_image_bytes:
        raise PipelineError("INVALID_IMAGE", "Image is empty or exceeds the allowed size.")
    if not raw.startswith(b"\xff\xd8\xff"):
        raise PipelineError("INVALID_IMAGE_TYPE", "Only JPEG image data is accepted.")

    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise PipelineError("INVALID_IMAGE", "Image data could not be decoded.")

    height, width = image.shape[:2]
    if (
        width < 160
        or height < 160
        or width > settings.maximum_image_dimension
        or height > settings.maximum_image_dimension
    ):
        raise PipelineError("INVALID_IMAGE_DIMENSIONS", "Image dimensions are outside the supported range.")
    return image


def normalize_embedding(feature: np.ndarray) -> list[float]:
    vector = np.asarray(feature, dtype=np.float32).reshape(-1)
    if vector.size != 128 or not np.isfinite(vector).all():
        raise PipelineError("INVALID_EMBEDDING", "The recognition model returned an invalid embedding.")
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        raise PipelineError("INVALID_EMBEDDING", "The recognition model returned a zero embedding.")
    return (vector / norm).tolist()


class FacePipeline:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.detector = cv2.FaceDetectorYN.create(
            str(settings.yunet_model_path),
            "",
            (320, 320),
            settings.detection_threshold,
            0.3,
            5000,
        )
        self.recognizer = cv2.FaceRecognizerSF.create(str(settings.sface_model_path), "")
        self.inference_lock = Lock()

    def _detect(self, image: np.ndarray) -> tuple[list[np.ndarray], str]:
        height, width = image.shape[:2]
        self.detector.setInputSize((width, height))
        _, faces = self.detector.detect(image)
        if faces is None or len(faces) == 0:
            return [], "no_face"
        if len(faces) != 1:
            return [np.asarray(face) for face in faces], "multiple_faces"

        face = np.asarray(faces[0], dtype=np.float32)
        if face.shape[0] < 15 or not np.isfinite(face[:15]).all():
            return [face], "quality_insufficient"

        x, y, width, height = face[:4]
        landmarks = face[4:14]
        confidence = face[14]
        if (
            width < self.settings.minimum_face_size
            or height < self.settings.minimum_face_size
            or confidence < self.settings.detection_threshold
            or landmarks.size != 10
            or not np.isfinite(landmarks).all()
        ):
            return [face], "quality_insufficient"

        bounds = {
            "x": max(0, int(x)),
            "y": max(0, int(y)),
            "width": int(width),
            "height": int(height),
        }
        return [face], "ready"

    def inspect(self, raw: bytes) -> dict:
        started = perf_counter()
        image = decode_image(raw, self.settings)
        detection_started = perf_counter()
        with self.inference_lock:
            faces, state = self._detect(image)
        detection_latency = (perf_counter() - detection_started) * 1000
        bounds = None
        if state == "ready":
            face = faces[0]
            bounds = {
                "x": max(0, int(face[0])),
                "y": max(0, int(face[1])),
                "width": int(face[2]),
                "height": int(face[3]),
            }
        return {
            "state": state,
            "bounds": bounds,
            "image": {"width": image.shape[1], "height": image.shape[0]},
            "detectionLatencyMs": round(detection_latency, 2),
            "totalLatencyMs": round((perf_counter() - started) * 1000, 2),
        }

    def embedding(self, raw: bytes) -> dict:
        started = perf_counter()
        image = decode_image(raw, self.settings)
        detection_started = perf_counter()
        with self.inference_lock:
            faces, state = self._detect(image)
            if state != "ready":
                reason_codes = {
                    "no_face": "NO_FACE_DETECTED",
                    "multiple_faces": "MULTIPLE_FACES_DETECTED",
                    "quality_insufficient": "FACE_QUALITY_INSUFFICIENT",
                }
                raise PipelineError(
                    reason_codes.get(state, "FACE_QUALITY_INSUFFICIENT"),
                    "The image did not contain one suitable face.",
                )

            detection_latency = (perf_counter() - detection_started) * 1000
            alignment_started = perf_counter()
            try:
                aligned = self.recognizer.alignCrop(image, faces[0][:14])
                alignment_latency = (perf_counter() - alignment_started) * 1000
                recognition_started = perf_counter()
                feature = self.recognizer.feature(aligned)
                recognition_latency = (perf_counter() - recognition_started) * 1000
            except cv2.error as error:
                raise PipelineError(
                    "FACE_QUALITY_INSUFFICIENT",
                    "The detected face could not be aligned for recognition.",
                ) from error

        return {
            "embedding": normalize_embedding(feature),
            "modelVersion": self.settings.model_version,
            "faceQuality": "acceptable",
            "detectionLatencyMs": round(detection_latency, 2),
            "alignmentLatencyMs": round(alignment_latency, 2),
            "recognitionLatencyMs": round(recognition_latency, 2),
            "totalLatencyMs": round((perf_counter() - started) * 1000, 2),
        }
