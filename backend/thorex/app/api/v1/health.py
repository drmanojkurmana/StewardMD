from fastapi import APIRouter
from app.core.config import get_settings

router = APIRouter()

@router.get("/health")
def health():
    return {"status": "ok", "service": "thorex", "mode": get_settings().mode}
