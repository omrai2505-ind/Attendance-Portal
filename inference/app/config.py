import os
from dataclasses import dataclass
from pathlib import Path


MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


@dataclass(frozen=True)
class Settings:
    yunet_model_path: Path
    sface_model_path: Path
    service_token: str
    detection_threshold: float
    minimum_face_size: int
    maximum_image_bytes: int
    maximum_image_dimension: int
    model_version: str


def load_settings() -> Settings:
    return Settings(
        yunet_model_path=Path(
            os.getenv("YUNET_MODEL_PATH", str(MODEL_DIR / "face_detection_yunet_2023mar.onnx"))
        ),
        sface_model_path=Path(
            os.getenv("SFACE_MODEL_PATH", str(MODEL_DIR / "face_recognition_sface_2021dec.onnx"))
        ),
        service_token=os.getenv("FACE_SERVICE_TOKEN", ""),
        detection_threshold=float(os.getenv("FACE_DETECTION_THRESHOLD", "0.9")),
        minimum_face_size=int(os.getenv("FACE_MINIMUM_SIZE", "96")),
        maximum_image_bytes=2 * 1024 * 1024,
        maximum_image_dimension=1920,
        model_version="yunet-2023mar+sface-2021dec-opencv-4.11",
    )
