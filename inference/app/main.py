import hmac
import logging
from contextlib import asynccontextmanager

import cv2
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .config import load_settings
from .liveness import assess_liveness
from .pipeline import FacePipeline, PipelineError


load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face-inference")
settings = load_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        app.state.pipeline = FacePipeline(settings)
        app.state.model_error = None
        logger.info("Face inference models loaded: %s", settings.model_version)
    except (OSError, cv2.error) as error:
        app.state.pipeline = None
        app.state.model_error = type(error).__name__
        logger.error("Face inference model initialization failed: %s", type(error).__name__)
    yield


app = FastAPI(title="Attendance face inference", docs_url=None, redoc_url=None, lifespan=lifespan)


def authorize_service(token: str | None) -> None:
    if not settings.service_token:
        raise HTTPException(status_code=503, detail={"reasonCode": "SERVICE_NOT_CONFIGURED"})
    if not token or not hmac.compare_digest(token, settings.service_token):
        raise HTTPException(status_code=401, detail={"reasonCode": "UNAUTHORIZED"})


async def get_jpeg(request: Request) -> bytes:
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "image/jpeg":
        raise HTTPException(status_code=415, detail={"reasonCode": "INVALID_IMAGE_TYPE"})

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared_length = int(content_length)
        except ValueError as error:
            raise HTTPException(status_code=400, detail={"reasonCode": "INVALID_CONTENT_LENGTH"}) from error
        if declared_length < 0:
            raise HTTPException(status_code=400, detail={"reasonCode": "INVALID_CONTENT_LENGTH"})
        if declared_length > settings.maximum_image_bytes:
            raise HTTPException(status_code=413, detail={"reasonCode": "IMAGE_TOO_LARGE"})

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > settings.maximum_image_bytes:
            raise HTTPException(status_code=413, detail={"reasonCode": "IMAGE_TOO_LARGE"})
    return bytes(body)


def get_pipeline() -> FacePipeline:
    pipeline = getattr(app.state, "pipeline", None)
    if pipeline is None:
        raise HTTPException(status_code=503, detail={"reasonCode": "MODEL_SERVICE_UNAVAILABLE"})
    return pipeline


@app.get("/health")
def health() -> dict:
    models_ready = getattr(app.state, "pipeline", None) is not None
    return {
        "ready": models_ready and bool(settings.service_token),
        "modelsReady": models_ready,
        "modelVersion": settings.model_version,
        "liveness": "unavailable",
        "reasonCode": (
            None
            if models_ready and settings.service_token
            else "SERVICE_NOT_CONFIGURED"
            if models_ready
            else "MODEL_SERVICE_UNAVAILABLE"
        ),
    }


@app.post("/v1/face/inspect")
async def inspect_face(request: Request, x_face_service_key: str | None = Header(default=None)) -> dict:
    authorize_service(x_face_service_key)
    image = await get_jpeg(request)
    pipeline = get_pipeline()
    try:
        return await run_in_threadpool(pipeline.inspect, image)
    except PipelineError as error:
        raise HTTPException(status_code=400, detail={"reasonCode": error.reason_code}) from error


@app.post("/v1/face/embedding")
async def create_embedding(
    request: Request,
    x_face_service_key: str | None = Header(default=None),
) -> dict:
    authorize_service(x_face_service_key)
    image = await get_jpeg(request)
    pipeline = get_pipeline()
    try:
        result = await run_in_threadpool(pipeline.embedding, image)
    except PipelineError as error:
        status_code = 400 if error.reason_code in {
            "INVALID_IMAGE",
            "INVALID_IMAGE_DIMENSIONS",
        } else 422
        raise HTTPException(status_code=status_code, detail={"reasonCode": error.reason_code}) from error
    result["liveness"] = assess_liveness(None)
    return result
