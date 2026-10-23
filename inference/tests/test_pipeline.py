import unittest
from pathlib import Path

import cv2
import numpy as np

from app.config import Settings
from app.liveness import assess_liveness
from app.pipeline import FacePipeline, PipelineError, decode_image, normalize_embedding


def settings() -> Settings:
    return Settings(
        yunet_model_path=Path("unused-yunet.onnx"),
        sface_model_path=Path("unused-sface.onnx"),
        service_token="test",
        detection_threshold=0.9,
        minimum_face_size=96,
        maximum_image_bytes=2 * 1024 * 1024,
        maximum_image_dimension=1920,
        model_version="test-model",
    )


class FakeDetector:
    def __init__(self, faces):
        self.faces = faces

    def setInputSize(self, _size):
        return None

    def detect(self, _image):
        return 1, self.faces


def face_row(width=180, height=180):
    return np.array(
        [100, 100, width, height, 125, 135, 175, 135, 150, 160, 130, 195, 170, 195, 0.99],
        dtype=np.float32,
    )


class FacePipelineTests(unittest.TestCase):
    def pipeline_with_faces(self, faces):
        pipeline = FacePipeline.__new__(FacePipeline)
        pipeline.settings = settings()
        pipeline.detector = FakeDetector(faces)
        return pipeline

    def test_invalid_or_non_jpeg_image_is_rejected(self):
        with self.assertRaises(PipelineError) as error:
            decode_image(b"not an image", settings())
        self.assertEqual(error.exception.reason_code, "INVALID_IMAGE_TYPE")

    def test_oversized_image_is_rejected_before_decode(self):
        config = settings()
        config = Settings(**{**config.__dict__, "maximum_image_bytes": 4})
        with self.assertRaises(PipelineError) as error:
            decode_image(b"\xff\xd8\xff" + b"x" * 4, config)
        self.assertEqual(error.exception.reason_code, "INVALID_IMAGE")

    def test_no_face_is_reported_explicitly(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        pipeline = self.pipeline_with_faces(None)
        self.assertEqual(pipeline._detect(image)[1], "no_face")

    def test_multiple_faces_are_not_selected_implicitly(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        pipeline = self.pipeline_with_faces(np.array([face_row(), face_row()]))
        faces, state = pipeline._detect(image)
        self.assertEqual(state, "multiple_faces")
        self.assertEqual(len(faces), 2)

    def test_small_face_is_rejected_as_insufficient_quality(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        pipeline = self.pipeline_with_faces(np.array([face_row(width=40, height=40)]))
        self.assertEqual(pipeline._detect(image)[1], "quality_insufficient")

    def test_liveness_assessment_default_and_unavailable(self):
        self.assertEqual(
            assess_liveness(None),
            {"status": "pass", "reasonCode": None},
        )

    def test_embedding_output_is_checked_and_normalized(self):
        feature = np.zeros((1, 128), dtype=np.float32)
        feature[0, 0] = 3
        embedding = normalize_embedding(feature)
        self.assertEqual(len(embedding), 128)
        self.assertAlmostEqual(float(np.linalg.norm(embedding)), 1.0)

        with self.assertRaises(PipelineError):
            normalize_embedding(np.ones((1, 127), dtype=np.float32))
        with self.assertRaises(PipelineError):
            normalize_embedding(np.zeros((1, 128), dtype=np.float32))
        invalid = np.ones((1, 128), dtype=np.float32)
        invalid[0, 0] = np.nan
        with self.assertRaises(PipelineError):
            normalize_embedding(invalid)

    def test_jpeg_dimensions_are_checked_after_decode(self):
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        encoded, buffer = cv2.imencode(".jpg", image)
        self.assertTrue(encoded)
        decoded = decode_image(buffer.tobytes(), settings())
        self.assertEqual(decoded.shape[:2], (480, 640))


if __name__ == "__main__":
    unittest.main()
