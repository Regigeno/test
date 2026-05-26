from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# OpenRouter config
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')
OPENROUTER_MODEL = os.environ.get('OPENROUTER_MODEL', 'openrouter/owl-alpha')
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are Prototype-OA, a helpful, concise, and friendly AI assistant powered by the OWL Alpha model. "
    "Provide clear, accurate, and well-structured answers. Use markdown formatting when helpful."
)

# Create the main app without a prefix
app = FastAPI(title="Prototype-OA API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Models ----------
class MessageIn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: str = Field(default_factory=now_iso)


class Conversation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "New chat"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ConversationCreate(BaseModel):
    title: Optional[str] = "New chat"


class ConversationRename(BaseModel):
    title: str


class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    stream: bool = True


class ChatNonStreamResponse(BaseModel):
    conversation_id: str
    assistant_message: Message
    title: str


# ---------- Helpers ----------
async def get_or_create_conversation(conversation_id: Optional[str]) -> dict:
    if conversation_id:
        conv = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
        if conv:
            return conv
    conv = Conversation().model_dump()
    await db.conversations.insert_one(conv.copy())
    return conv


async def get_conversation_history(conversation_id: str, limit: int = 40) -> List[dict]:
    cursor = db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1)
    msgs = await cursor.to_list(length=limit)
    return msgs


def build_openrouter_messages(history: List[dict], new_user_message: str) -> List[dict]:
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history:
        if m.get("role") in ("user", "assistant"):
            msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": new_user_message})
    return msgs


async def generate_title_from_message(user_message: str) -> str:
    """Use the model to create a short conversation title."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            resp = await http.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENROUTER_MODEL,
                    "messages": [
                        {"role": "system", "content": "Generate a very short (max 6 words) descriptive title for the following user message. Respond with ONLY the title, no quotes, no punctuation at the end."},
                        {"role": "user", "content": user_message},
                    ],
                    "max_tokens": 30,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                title = data["choices"][0]["message"]["content"].strip().strip('"').strip("'")
                if title:
                    return title[:80]
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
    # Fallback: derive from first words
    words = user_message.strip().split()
    return (" ".join(words[:6]) or "New chat")[:80]


# ---------- Endpoints ----------
@api_router.get("/")
async def root():
    return {"app": "Prototype-OA", "model": OPENROUTER_MODEL, "status": "ok"}


@api_router.get("/health")
async def health():
    return {"status": "healthy", "model": OPENROUTER_MODEL}


@api_router.get("/conversations", response_model=List[Conversation])
async def list_conversations():
    cursor = db.conversations.find({}, {"_id": 0}).sort("updated_at", -1)
    convs = await cursor.to_list(length=500)
    return convs


@api_router.post("/conversations", response_model=Conversation)
async def create_conversation(payload: ConversationCreate):
    conv = Conversation(title=payload.title or "New chat").model_dump()
    await db.conversations.insert_one(conv.copy())
    return conv


@api_router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conv = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = await get_conversation_history(conversation_id, limit=500)
    return {"conversation": conv, "messages": msgs}


@api_router.patch("/conversations/{conversation_id}", response_model=Conversation)
async def rename_conversation(conversation_id: str, payload: ConversationRename):
    title = (payload.title or "").strip()[:120] or "New chat"
    result = await db.conversations.find_one_and_update(
        {"id": conversation_id},
        {"$set": {"title": title, "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result


@api_router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    res = await db.conversations.delete_one({"id": conversation_id})
    await db.messages.delete_many({"conversation_id": conversation_id})
    return {"deleted": res.deleted_count, "conversation_id": conversation_id}


@api_router.delete("/conversations")
async def clear_all_conversations():
    c = await db.conversations.delete_many({})
    m = await db.messages.delete_many({})
    return {"conversations_deleted": c.deleted_count, "messages_deleted": m.deleted_count}


@api_router.post("/chat")
async def chat(req: ChatRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured")
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    conv = await get_or_create_conversation(req.conversation_id)
    conv_id = conv["id"]
    is_new_conv = not req.conversation_id
    history = await get_conversation_history(conv_id, limit=40)

    # Persist user message
    user_msg = Message(conversation_id=conv_id, role="user", content=req.message.strip()).model_dump()
    await db.messages.insert_one(user_msg.copy())

    or_messages = build_openrouter_messages(history, req.message.strip())
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": or_messages,
        "stream": req.stream,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://prototype-oa.app",
        "X-Title": "Prototype-OA",
    }

    if not req.stream:
        # Non-streaming path
        try:
            async with httpx.AsyncClient(timeout=120.0) as http:
                resp = await http.post(OPENROUTER_URL, headers=headers, json=payload)
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code, detail=f"OpenRouter error: {resp.text}")
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Chat request failed")
            raise HTTPException(status_code=500, detail=str(e))

        asst_msg = Message(conversation_id=conv_id, role="assistant", content=content).model_dump()
        await db.messages.insert_one(asst_msg.copy())

        title = conv["title"]
        if is_new_conv or conv.get("title") in (None, "", "New chat"):
            title = await generate_title_from_message(req.message)
        await db.conversations.update_one(
            {"id": conv_id},
            {"$set": {"title": title, "updated_at": now_iso()}},
        )
        return ChatNonStreamResponse(conversation_id=conv_id, assistant_message=Message(**asst_msg), title=title)

    # Streaming path (SSE)
    async def event_stream():
        # Send conversation id first
        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conv_id, 'is_new': is_new_conv})}\n\n"
        assistant_content_parts: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=None) as http:
                async with http.stream("POST", OPENROUTER_URL, headers=headers, json=payload) as resp:
                    if resp.status_code != 200:
                        err_text = (await resp.aread()).decode("utf-8", errors="ignore")
                        yield f"data: {json.dumps({'type': 'error', 'detail': err_text[:500]})}\n\n"
                        return
                    async for raw_line in resp.aiter_lines():
                        if not raw_line:
                            continue
                        # OpenRouter SSE keep-alive lines may start with ':' - skip
                        if raw_line.startswith(":"):
                            continue
                        if not raw_line.startswith("data:"):
                            continue
                        data_str = raw_line[len("data:"):].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                        except Exception:
                            continue
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        piece = delta.get("content") or ""
                        if piece:
                            assistant_content_parts.append(piece)
                            yield f"data: {json.dumps({'type': 'token', 'content': piece})}\n\n"
        except Exception as e:
            logger.exception("Streaming error")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"
            return

        full_content = "".join(assistant_content_parts).strip()
        if full_content:
            asst_msg = Message(conversation_id=conv_id, role="assistant", content=full_content).model_dump()
            await db.messages.insert_one(asst_msg.copy())

        title = conv["title"]
        if is_new_conv or conv.get("title") in (None, "", "New chat"):
            title = await generate_title_from_message(req.message)
        await db.conversations.update_one(
            {"id": conv_id},
            {"$set": {"title": title, "updated_at": now_iso()}},
        )
        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conv_id, 'title': title})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
