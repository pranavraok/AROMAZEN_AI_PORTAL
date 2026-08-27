from uuid import UUID

from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class StreamChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    conversation_id: UUID | None = None
    collection_ids: list[UUID] = Field(default_factory=list, max_length=25)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=8)
    mode: Literal["chat", "image", "email"] = "chat"
    response_mode: Literal["auto", "quick", "standard", "deep", "essential"] = "auto"


class ConversationUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class EmailSendRequest(BaseModel):
    message_id: UUID
    to: list[EmailStr] = Field(min_length=1, max_length=20)
    cc: list[EmailStr] = Field(default_factory=list, max_length=20)
    bcc: list[EmailStr] = Field(default_factory=list, max_length=20)
    subject: str = Field(min_length=1, max_length=240)
    body: str = Field(min_length=1, max_length=20000)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=8)
