from uuid import UUID

from pydantic import BaseModel, Field


class StreamChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    conversation_id: UUID | None = None
    collection_ids: list[UUID] = Field(default_factory=list, max_length=25)
