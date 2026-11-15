"""Small in-memory rate limiter (per client IP, sliding one-minute window)."""

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.errors import AppError

_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def limit(bucket: str, per_minute: int):
    """FastAPI dependency: at most `per_minute` requests per minute per client for this bucket."""

    def dep(request: Request) -> None:
        client = request.client.host if request.client else "unknown"
        key = f"{bucket}:{client}"
        now = time.time()
        with _lock:
            q = _hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= per_minute:
                raise AppError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.")
            q.append(now)

    return dep


def reset() -> None:
    _hits.clear()
