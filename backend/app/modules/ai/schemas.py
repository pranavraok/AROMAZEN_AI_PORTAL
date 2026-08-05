from uuid import UUID

from typing import Literal

from pydantic import BaseModel, Field


class StreamChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    conversation_id: UUID | None = None
    collection_ids: list[UUID] = Field(default_factory=list, max_length=25)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=8)
    mode: Literal["chat", "image"] = "chat"


class ConversationUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
