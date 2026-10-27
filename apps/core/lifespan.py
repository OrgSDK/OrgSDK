"""One API process owns the database and its background maintenance loop."""

import asyncio
import fcntl
import logging
from contextlib import suppress
from pathlib import Path

from asgiref.sync import sync_to_async
from django.db import connections

from .jobs import maintenance_tick, recover_interrupted_jobs

logger = logging.getLogger(__name__)


async def maintain(stop):
    while not stop.is_set():
        try:
            worked = await sync_to_async(maintenance_tick, thread_sensitive=False)()
        except Exception:
            logger.exception("API maintenance tick failed; retrying")
            worked = False
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=0.1 if worked else 1)


class ServerApplication:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope["type"] != "lifespan":
            return await self.application(scope, receive, send)
        lock = None
        stop = asyncio.Event()
        try:
            await receive()
            database = Path(connections["default"].settings_dict["NAME"])
            lock = (database.parent / "api.lock").open("a")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            await sync_to_async(recover_interrupted_jobs, thread_sensitive=False)()
            worker = asyncio.create_task(maintain(stop))
            await send({"type": "lifespan.startup.complete"})
        except Exception as error:
            if lock:
                lock.close()
            await send({"type": "lifespan.startup.failed", "message": str(error)})
            return
        try:
            await receive()
            stop.set()
            await worker
            await send({"type": "lifespan.shutdown.complete"})
        finally:
            stop.set()
            lock.close()
