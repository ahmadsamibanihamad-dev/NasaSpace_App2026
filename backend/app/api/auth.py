from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.api.deps import current_user
from app.api.schemas import AuthOut, ForgotIn, LoginIn, RegisterIn, UserOut, UserUpdateIn
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import AppError
from app.core.ratelimit import limit
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
# stricter limit on the endpoints that can be used to guess passwords or create accounts in bulk
_strict = [Depends(limit("credentials", get_settings().rate_limit_auth))]


def _out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, full_name=u.full_name, language=u.language, area_unit=u.area_unit, created_at=u.created_at)


@router.post("/register", response_model=AuthOut, status_code=201, dependencies=_strict)
def register(body: RegisterIn, session: Session = Depends(get_session)):
    email = body.email.lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise AppError(409, "EMAIL_TAKEN", "Email already registered")
    u = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password))
    session.add(u)
    session.commit()
    session.refresh(u)
    return AuthOut(access_token=create_access_token(u.id), user=_out(u))


@router.post("/login", response_model=AuthOut, dependencies=_strict)
def login(body: LoginIn, session: Session = Depends(get_session)):
    u = session.exec(select(User).where(User.email == body.email.lower())).first()
    if not u or not verify_password(body.password, u.password_hash):
        raise AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password")
    return AuthOut(access_token=create_access_token(u.id), user=_out(u))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return _out(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdateIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    session.add(user)
    session.commit()
    session.refresh(user)
    return _out(user)


@router.post("/forgot-password", dependencies=_strict)
def forgot_password(_: ForgotIn):
    # Stub: no email is sent. Always returns the same response to avoid account enumeration.
    return {"ok": True, "stub": True}
