"""SQLite-backed in-memory job queue for resource-constrained devices.

Replaces direct MemoryManager usage in routers. Jobs are submitted to the
queue and executed FIFO, one at a time, batching same-type jobs to minimize
model swaps. The queue worker calls memory management functions when switching
job types.

When settings.use_queue is False, falls back to direct MemoryManager behavior.
"""

import asyncio
import json
import logging
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable

from .config import settings
from .memory import mem

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    EXPIRED = "expired"


class JobType(str, Enum):
    ASR = "asr"
    DIARIZATION = "diarization"
    LLM = "llm"


@dataclass
class Job:
    id: str
    type: JobType
    status: JobStatus
    payload: dict
    created_at: float
    updated_at: float
    ttl_seconds: int
    expires_at: float
    result: Any = None
    error: str | None = None


# Maps job type to memory slot name
_TYPE_TO_SLOT = {
    JobType.ASR: "asr",
    JobType.DIARIZATION: "diarization",
    JobType.LLM: "ollama",
}


def _ttl_for_type(job_type: JobType) -> int:
    """Get TTL from settings for a given job type."""
    return {
        JobType.ASR: settings.asr_job_ttl,
        JobType.DIARIZATION: settings.diarize_job_ttl,
        JobType.LLM: settings.llm_job_ttl,
    }[job_type]


class _SqliteStore:
    """Thread-safe SQLite :memory: store for job metadata."""

    def __init__(self) -> None:
        self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        self._lock = threading.Lock()
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                payload TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                ttl_seconds INTEGER DEFAULT 300,
                expires_at REAL NOT NULL
            )"""
        )
        self._conn.commit()

    def insert(self, job: Job) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs (id, type, status, payload, created_at, updated_at, ttl_seconds, expires_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (job.id, job.type.value, job.status.value, json.dumps(job.payload),
                 job.created_at, job.updated_at, job.ttl_seconds, job.expires_at),
            )
            self._conn.commit()

    def pop_next(self, prefer_type: str | None = None) -> Job | None:
        """Pop the next pending job. Prefers same-type jobs to avoid model swaps."""
        with self._lock:
            row = None
            if prefer_type:
                row = self._conn.execute(
                    "SELECT id, type, status, payload, created_at, updated_at, ttl_seconds, expires_at "
                    "FROM jobs WHERE status = 'pending' AND type = ? ORDER BY created_at ASC LIMIT 1",
                    (prefer_type,),
                ).fetchone()
            if row is None:
                row = self._conn.execute(
                    "SELECT id, type, status, payload, created_at, updated_at, ttl_seconds, expires_at "
                    "FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
                ).fetchone()
            if row is None:
                return None

            now = time.time()
            self._conn.execute(
                "UPDATE jobs SET status = 'running', updated_at = ?, expires_at = ? WHERE id = ?",
                (now, now + row[6], row[0]),
            )
            self._conn.commit()
            return Job(
                id=row[0], type=JobType(row[1]), status=JobStatus.RUNNING,
                payload=json.loads(row[3]) if row[3] else {},
                created_at=row[4], updated_at=now, ttl_seconds=row[6],
                expires_at=now + row[6],
            )

    def heartbeat(self, job_id: str) -> None:
        """Push expires_at forward by the job's TTL."""
        with self._lock:
            row = self._conn.execute(
                "SELECT ttl_seconds FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row:
                now = time.time()
                self._conn.execute(
                    "UPDATE jobs SET updated_at = ?, expires_at = ? WHERE id = ?",
                    (now, now + row[0], job_id),
                )
                self._conn.commit()

    def complete(self, job_id: str) -> None:
        with self._lock:
            now = time.time()
            self._conn.execute(
                "UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?",
                (now, job_id),
            )
            self._conn.commit()

    def fail(self, job_id: str, error: str) -> None:
        with self._lock:
            now = time.time()
            self._conn.execute(
                "UPDATE jobs SET status = 'failed', updated_at = ? WHERE id = ?",
                (now, job_id),
            )
            self._conn.commit()

    def expire_stale(self) -> list[str]:
        """Mark expired jobs and return their IDs."""
        with self._lock:
            now = time.time()
            rows = self._conn.execute(
                "SELECT id FROM jobs WHERE status = 'running' AND expires_at < ?",
                (now,),
            ).fetchall()
            if rows:
                ids = [r[0] for r in rows]
                self._conn.execute(
                    f"UPDATE jobs SET status = 'expired', updated_at = ? "
                    f"WHERE id IN ({','.join('?' * len(ids))})",
                    [now, *ids],
                )
                self._conn.commit()
                return ids
            return []

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, type, status, payload, created_at, updated_at, ttl_seconds, expires_at "
                "FROM jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if row is None:
                return None
            return Job(
                id=row[0], type=JobType(row[1]), status=JobStatus(row[2]),
                payload=json.loads(row[3]) if row[3] else {},
                created_at=row[4], updated_at=row[5], ttl_seconds=row[6],
                expires_at=row[7],
            )

    def queue_depth(self) -> dict[str, int]:
        """Return pending job count per type."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT type, COUNT(*) FROM jobs WHERE status = 'pending' GROUP BY type"
            ).fetchall()
            return {r[0]: r[1] for r in rows}

    def current_running(self) -> Job | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, type, status, payload, created_at, updated_at, ttl_seconds, expires_at "
                "FROM jobs WHERE status = 'running' ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            return Job(
                id=row[0], type=JobType(row[1]), status=JobStatus(row[2]),
                payload=json.loads(row[3]) if row[3] else {},
                created_at=row[4], updated_at=row[5], ttl_seconds=row[6],
                expires_at=row[7],
            )

    def cleanup_old(self, max_age: float = 3600.0) -> int:
        """Remove completed/failed/expired jobs older than max_age seconds."""
        with self._lock:
            cutoff = time.time() - max_age
            cursor = self._conn.execute(
                "DELETE FROM jobs WHERE status IN ('done', 'failed', 'expired') AND updated_at < ?",
                (cutoff,),
            )
            self._conn.commit()
            return cursor.rowcount


# Registered job handlers: job_type -> async callable(job) -> result
_handlers: dict[JobType, Callable] = {}


def register_handler(job_type: JobType, handler: Callable) -> None:
    """Register an async handler for a job type."""
    _handlers[job_type] = handler


class JobQueue:
    """Async job queue that processes one job at a time."""

    def __init__(self) -> None:
        self._store = _SqliteStore()
        self._event = asyncio.Event()
        self._current_type: JobType | None = None
        self._worker_task: asyncio.Task | None = None
        self._monitor_task: asyncio.Task | None = None
        # Map job_id -> asyncio.Event for callers waiting on results
        self._completion_events: dict[str, asyncio.Event] = {}
        # Map job_id -> result or exception
        self._results: dict[str, Any] = {}

    async def start(self) -> None:
        """Start the worker and monitor background tasks."""
        self._worker_task = asyncio.create_task(self._worker_loop())
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info("queue: worker and monitor started")

    async def stop(self) -> None:
        """Stop background tasks."""
        if self._worker_task:
            self._worker_task.cancel()
        if self._monitor_task:
            self._monitor_task.cancel()
        logger.info("queue: stopped")

    def submit(self, job_type: JobType, payload: dict | None = None) -> str:
        """Submit a job and return its ID."""
        now = time.time()
        ttl = _ttl_for_type(job_type)
        job = Job(
            id=uuid.uuid4().hex[:16],
            type=job_type,
            status=JobStatus.PENDING,
            payload=payload or {},
            created_at=now,
            updated_at=now,
            ttl_seconds=ttl,
            expires_at=now + ttl,
        )
        self._store.insert(job)
        self._completion_events[job.id] = asyncio.Event()
        self._event.set()  # wake up worker
        logger.info("queue: submitted job %s type=%s", job.id, job.type.value)
        return job.id

    async def wait_for_result(self, job_id: str, timeout: float | None = None) -> Any:
        """Wait for a job to complete and return its result."""
        event = self._completion_events.get(job_id)
        if event is None:
            raise ValueError(f"Unknown job: {job_id}")
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"Job {job_id} timed out")
        result = self._results.pop(job_id, None)
        self._completion_events.pop(job_id, None)
        if isinstance(result, Exception):
            raise result
        return result

    def heartbeat(self, job_id: str) -> None:
        """Push the job's expiry forward."""
        self._store.heartbeat(job_id)

    def get_job(self, job_id: str) -> Job | None:
        return self._store.get(job_id)

    async def _worker_loop(self) -> None:
        """Process jobs one at a time, batching same-type jobs."""
        while True:
            try:
                # Wait for a signal that a job was submitted
                await self._event.wait()
                self._event.clear()

                while True:
                    # Prefer same type as current to avoid model swaps
                    prefer = self._current_type.value if self._current_type else None
                    job = self._store.pop_next(prefer_type=prefer)
                    if job is None:
                        break

                    # Switch memory slot if job type changed
                    slot = _TYPE_TO_SLOT[job.type]
                    if self._current_type != job.type:
                        mem.acquire(slot)
                        self._current_type = job.type

                    handler = _handlers.get(job.type)
                    if handler is None:
                        err = f"No handler registered for {job.type.value}"
                        logger.error("queue: %s", err)
                        self._store.fail(job.id, err)
                        self._signal_completion(job.id, RuntimeError(err))
                        continue

                    try:
                        result = await handler(job)
                        self._store.complete(job.id)
                        self._signal_completion(job.id, result)
                    except Exception as e:
                        logger.exception("queue: job %s failed", job.id)
                        self._store.fail(job.id, str(e))
                        self._signal_completion(job.id, e)

            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("queue: worker loop error")
                await asyncio.sleep(1)

    def _signal_completion(self, job_id: str, result: Any) -> None:
        """Signal that a job completed (with result or exception)."""
        self._results[job_id] = result
        event = self._completion_events.get(job_id)
        if event:
            event.set()

    async def _monitor_loop(self) -> None:
        """Periodic monitoring: expire stale jobs, log stats."""
        while True:
            try:
                await asyncio.sleep(settings.queue_monitor_interval)

                # Expire stale running jobs
                expired = self._store.expire_stale()
                for job_id in expired:
                    logger.warning("queue: expired stale job %s", job_id)
                    self._signal_completion(job_id, TimeoutError(f"Job {job_id} expired"))

                # Clean up old completed jobs
                self._store.cleanup_old()

                # Log stats
                depth = self._store.queue_depth()
                running = self._store.current_running()
                try:
                    import psutil
                    proc = psutil.Process()
                    rss_mb = proc.memory_info().rss / (1024 * 1024)
                    cpu = psutil.cpu_percent(interval=None)
                    logger.info(
                        "queue: depth=%s current=%s rss=%.0fMB cpu=%.1f%%",
                        depth,
                        running.type.value if running else "idle",
                        rss_mb,
                        cpu,
                    )
                except ImportError:
                    logger.info(
                        "queue: depth=%s current=%s (psutil not installed)",
                        depth,
                        running.type.value if running else "idle",
                    )

            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("queue: monitor error")


# Singleton
job_queue = JobQueue()
