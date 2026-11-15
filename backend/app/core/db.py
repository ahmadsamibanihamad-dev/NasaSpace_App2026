from collections.abc import Iterator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import get_settings

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        url = get_settings().database_url
        _engine = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
        if url.startswith("sqlite"):

            @event.listens_for(_engine, "connect")
            def _fk_on(dbapi_conn, _):  # pragma: no cover - trivial
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA journal_mode=WAL")
                cur.close()

    return _engine


def set_engine(engine) -> None:
    """Used by tests to inject an in-memory engine."""
    global _engine
    _engine = engine


def init_db() -> None:
    from app import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(get_engine())
    _add_missing_columns()


# Columns added after the first release. `create_all` creates missing tables but never alters an
# existing one, so a database made by an earlier version gets these added in place (no data is touched).
ADDED_COLUMNS = [("plot", "soil_lab", "JSON")]


def _add_missing_columns() -> None:
    from sqlalchemy import inspect, text

    engine = get_engine()
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, column, sql_type in ADDED_COLUMNS:
            if column not in {c["name"] for c in inspector.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
