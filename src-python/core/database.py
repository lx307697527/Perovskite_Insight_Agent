from sqlalchemy import create_engine, Column, String, Integer, Float, Text, DateTime, Boolean, ForeignKey, Index, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import datetime
import os


def get_db_path():
    if os.name == 'nt':
        base_dir = os.environ.get('APPDATA', os.path.expanduser('~'))
    else:
        base_dir = os.path.expanduser('~')
    app_dir = os.path.join(base_dir, "SIA")
    if not os.path.exists(app_dir):
        os.makedirs(app_dir, exist_ok=True)
    return os.path.join(app_dir, "sia_database.db")


DATABASE_URL = f"sqlite:///{get_db_path()}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


# ============================================================
# V2.1 ORM Models — 6 entities
# ============================================================

class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)  # UUID
    name = Column(String, nullable=False)
    description = Column(Text)
    domain = Column(String, default="perovskite")  # perovskite / semiconductor / custom
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    literature = relationship("Literature", back_populates="project", lazy="dynamic")
    chat_sessions = relationship("ChatSession", back_populates="project", lazy="dynamic")


class Literature(Base):
    __tablename__ = "literature"
    __table_args__ = (
        Index("ix_literature_project_id", "project_id"),
        Index("ix_literature_extraction_stage", "extraction_stage"),
        Index("ix_literature_data_source", "data_source"),
    )

    doi = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)  # NULL = inbox
    title = Column(String)
    journal = Column(String)
    year = Column(Integer)
    authors = Column(String)
    abstract = Column(Text)

    is_extracted = Column(Boolean, default=False)
    extraction_stage = Column(String, default="none")  # none / stage1 / stage2 / failed
    data_source = Column(String, default="abstract")  # abstract / fulltext
    relevance_score = Column(Float)
    quality_flag = Column(String)  # OK / WARNING / ERROR

    local_pdf_path = Column(String)
    si_paths = Column(Text)  # JSON list of SI paths (legacy compat)

    performance_data = Column(Text)  # JSON (PerformanceMetric[])
    process_params = Column(Text)  # JSON
    stability_data = Column(Text)  # JSON
    source_mapping = Column(Text)  # JSON (traceability)
    cache_meta = Column(Text)  # JSON (cache metadata)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    project = relationship("Project", back_populates="literature")
    si_files = relationship("SIFile", back_populates="literature", cascade="all, delete-orphan")
    quick_questions = relationship("QuickQuestion", back_populates="literature", cascade="all, delete-orphan")


class SIFile(Base):
    __tablename__ = "si_files"
    __table_args__ = (
        Index("ix_sifile_literature_doi", "literature_doi"),
    )

    id = Column(String, primary_key=True)  # UUID
    literature_doi = Column(String, ForeignKey("literature.doi", ondelete="CASCADE"))
    url = Column(String)
    type = Column(String)  # pdf / docx / zip
    status = Column(String, default="pending")  # pending / downloading / ready / failed
    local_path = Column(String)

    literature = relationship("Literature", back_populates="si_files")


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index("ix_chatsession_project_id", "project_id"),
    )

    id = Column(String, primary_key=True)  # UUID
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"))
    query = Column(Text)  # conversation topic / first question
    context_dois = Column(Text)  # JSON array of DOIs
    created_at = Column(DateTime, default=utcnow)

    project = relationship("Project", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chatmessage_session_id", "session_id"),
    )

    id = Column(String, primary_key=True)  # UUID
    session_id = Column(String, ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role = Column(String)  # user / assistant
    content = Column(Text)
    source_refs = Column(Text)  # JSON [{doi, page, excerpt}]
    created_at = Column(DateTime, default=utcnow)

    session = relationship("ChatSession", back_populates="messages")


class QuickQuestion(Base):
    __tablename__ = "quick_questions"
    __table_args__ = (
        Index("ix_quickquestion_doi", "literature_doi"),
    )

    id = Column(String, primary_key=True)  # UUID
    literature_doi = Column(String, ForeignKey("literature.doi", ondelete="CASCADE"))
    question = Column(Text)
    answer = Column(Text)
    source = Column(Text)  # JSON {page, paragraph, excerpt}
    cost = Column(Float)  # USD
    tokens_used = Column(Integer)
    created_at = Column(DateTime, default=utcnow)

    literature = relationship("Literature", back_populates="quick_questions")


# ============================================================
# Legacy compatibility aliases
# ============================================================
# V1 code references Paper and ExtractionResult — keep as read-only views
# onto the new Literature table so existing endpoints keep working during migration.
Paper = Literature
ExtractionResult = Literature  # Will be replaced by proper queries in Phase 1


def init_db():
    Base.metadata.create_all(bind=engine)


def migrate_v1_data():
    """One-time migration from PIA_Agent V1 database to SIA V2 schema."""
    v1_path = os.path.join(
        os.environ.get('APPDATA', os.path.expanduser('~')),
        "PIA_Agent", "pia_database.db"
    )
    if not os.path.exists(v1_path):
        return False

    import shutil
    import sqlite3

    v1_dir = os.path.dirname(v1_path)
    migrated_marker = os.path.join(v1_dir, ".migrated_to_sia")
    if os.path.exists(migrated_marker):
        return False

    print(f"[Migration] Detected V1 database at {v1_path}, starting migration...")

    try:
        v1_conn = sqlite3.connect(v1_path)
        v1_conn.row_factory = sqlite3.Row
        rows = v1_conn.execute(
            "SELECT doi, title, journal, year, authors, abstract, "
            "local_path, si_paths, is_extracted FROM papers"
        ).fetchall()
        v1_conn.close()
    except Exception as e:
        print(f"[Migration] Failed to read V1 database: {e}")
        return False

    db = SessionLocal()
    try:
        for row in rows:
            doi = row["doi"]
            if not doi:
                continue
            existing = db.query(Literature).filter(Literature.doi == doi).first()
            if existing:
                continue

            lit = Literature(
                doi=doi,
                title=row["title"] or f"Auto-extracted {doi}",
                journal=row["journal"],
                year=row["year"],
                authors=row["authors"],
                abstract=row["abstract"],
                local_pdf_path=row["local_path"],
                si_paths=row["si_paths"],
                is_extracted=bool(row["is_extracted"]),
                extraction_stage="stage2" if row["is_extracted"] else "none",
                data_source="fulltext",
                project_id=None,  # goes to inbox
            )
            db.add(lit)

        db.commit()
        print(f"[Migration] Migrated {len(rows)} papers from V1 database.")

        # Mark V1 directory as migrated (rename)
        marker_path = migrated_marker
        with open(marker_path, "w") as f:
            f.write(f"Migrated to SIA V2 at {datetime.datetime.now().isoformat()}")

        return True
    except Exception as e:
        db.rollback()
        print(f"[Migration] Error during migration: {e}")
        return False
    finally:
        db.close()
