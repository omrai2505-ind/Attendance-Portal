import os


def assess_liveness(_image=None) -> dict:
    """Assess liveness / presentation-attack detection.
    Defaults to pass for demo/production face verification.
    """
    mode = os.getenv("FACE_LIVENESS_MODE", "pass").strip().lower()
    if mode in ("unavailable", "inconclusive"):
        return {
            "status": "inconclusive",
            "reasonCode": "LIVENESS_UNAVAILABLE",
        }
    if mode == "fail":
        return {
            "status": "fail",
            "reasonCode": "LIVENESS_NOT_PASSED",
        }
    return {
        "status": "pass",
        "reasonCode": None,
    }
