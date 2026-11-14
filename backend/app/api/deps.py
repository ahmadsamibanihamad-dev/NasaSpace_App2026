from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.core.db import get_session
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.models import Farm, Plot, User

bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), session: Session = Depends(get_session)) -> User:
    if not creds:
        raise AppError(401, "UNAUTHORIZED", "Missing bearer token")
    uid = decode_access_token(creds.credentials)
    user = session.get(User, uid) if uid else None
    if not user:
        raise AppError(401, "UNAUTHORIZED", "Invalid or expired token")
    return user


def owned_farm(session: Session, user: User, farm_id: str) -> Farm:
    farm = session.get(Farm, farm_id)
    if not farm or farm.user_id != user.id:
        raise AppError(404, "NOT_FOUND", "Farm not found")
    return farm


def owned_plot(session: Session, user: User, plot_id: str) -> Plot:
    plot = session.get(Plot, plot_id)
    if not plot:
        raise AppError(404, "NOT_FOUND", "Plot not found")
    owned_farm(session, user, plot.farm_id)
    return plot
