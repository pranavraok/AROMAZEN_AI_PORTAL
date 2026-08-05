import asyncio
import base64
import json
from dataclasses import dataclass, field
from typing import AsyncIterator

import httpx

from app.core.config import Settings, get_settings


@dataclass(slots=True)
class ProviderEvent:
    kind: str
    provider: str
    model: str
    text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    sources: list[dict[str, str]] = field(default_factory=list)


@dataclass(slots=True)
class EmbeddingResult:
    vectors: list[list[float]]
    input_tokens: int


@dataclass(slots=True)
class ImageGenerationResult:
    image_bytes: bytes
    model: str
    mime_type: str = "image/png"


class ProviderError(RuntimeError):
    def __init__(self, provider: str, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.retryable = retryable


def _timeouts(settings: Settings) -> httpx.Timeout:
    return httpx.Timeout(
        connect=settings.ai_connect_timeout_seconds,
        read=settings.ai_request_timeout_seconds,
        write=30.0,
        pool=10.0,
    )


async def _sse_json(response: httpx.Response) -> AsyncIterator[dict]:
    async for line in response.aiter_lines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            yield json.loads(data)
        except json.JSONDecodeError:
            continue


class OpenAIProvider:
    name = "openai"

    def __init__(self, settings: Settings, model: str | None = None):
        self.settings = settings
        self.model = model or settings.openai_chat_model

    @property
    def available(self) -> bool:
        return bool(self.settings.openai_api_key)

    async def stream(self, system: str, prompt: str, *, use_web_search: bool = False, images: list[dict[str, str]] | None = None) -> AsyncIterator[ProviderEvent]:
        if not self.settings.openai_api_key:
            raise ProviderError(self.name, "not_configured", "OpenAI is not configured.")
        headers = {"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"}
        input_content: str | list[dict[str, str]] = prompt
        if images:
            input_content = [{"type": "input_text", "text": prompt}] + [
                {"type": "input_image", "image_url": f"data:{image['mime_type']};base64,{image['data']}"}
                for image in images
            ]
        payload = {
            "model": self.model,
            "instructions": system,
            "input": input_content if isinstance(input_content, str) else [{"role": "user", "content": input_content}],
            "max_output_tokens": self.settings.ai_max_output_tokens,
            "reasoning": {"effort": "low"},
            "stream": True,
            "store": False,
        }
        if use_web_search:
            payload["tools"] = [{"type": "web_search", "search_context_size": "low"}]
        web_sources: list[dict[str, str]] = []
        seen_source_urls: set[str] = set()

        def remember_web_source(annotation: dict) -> None:
            citation = annotation.get("url_citation") or annotation
            url = str(citation.get("url") or "")
            if not url or url in seen_source_urls:
                return
            seen_source_urls.add(url)
            web_sources.append({"title": str(citation.get("title") or url), "url": url})
        try:
            async with httpx.AsyncClient(timeout=_timeouts(self.settings)) as client:
                async with client.stream("POST", "https://api.openai.com/v1/responses", headers=headers, json=payload) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        raise ProviderError(self.name, f"http_{response.status_code}", "OpenAI request failed.", retryable=response.status_code in {408, 409, 429} or response.status_code >= 500)
                    yield ProviderEvent("meta", self.name, self.model)
                    async for event in _sse_json(response):
                        event_type = event.get("type")
                        if event_type == "response.output_text.delta":
                            yield ProviderEvent("delta", self.name, self.model, text=event.get("delta", ""))
                        elif event_type == "response.output_text.annotation.added" and use_web_search:
                            annotation = event.get("annotation") or {}
                            if annotation.get("type") == "url_citation" or annotation.get("url_citation"):
                                remember_web_source(annotation)
                        elif event_type == "response.completed":
                            completed_response = event.get("response", {})
                            usage = completed_response.get("usage") or {}
                            if use_web_search:
                                for output_item in completed_response.get("output") or []:
                                    if output_item.get("type") != "message":
                                        continue
                                    for content_item in output_item.get("content") or []:
                                        for annotation in content_item.get("annotations") or []:
                                            if annotation.get("type") != "url_citation":
                                                continue
                                            remember_web_source(annotation)
                                if web_sources:
                                    yield ProviderEvent("sources", self.name, self.model, sources=web_sources)
                            yield ProviderEvent("usage", self.name, self.model, input_tokens=int(usage.get("input_tokens") or 0), output_tokens=int(usage.get("output_tokens") or 0))
                        elif event_type == "error":
                            raise ProviderError(self.name, str(event.get("code") or "stream_error"), "OpenAI stream failed.")
        except ProviderError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            raise ProviderError(self.name, "network_timeout", "OpenAI did not respond in time.", retryable=True) from error


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: Settings, model: str):
        self.settings = settings
        self.model = model

    @property
    def available(self) -> bool:
        return bool(self.settings.anthropic_api_key)

    async def stream(self, system: str, prompt: str, *, images: list[dict[str, str]] | None = None) -> AsyncIterator[ProviderEvent]:
        if not self.settings.anthropic_api_key:
            raise ProviderError(self.name, "not_configured", "Anthropic is not configured.")
        headers = {
            "x-api-key": self.settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        message_content: str | list[dict] = prompt
        if images:
            message_content = [
                {"type": "image", "source": {"type": "base64", "media_type": image["mime_type"], "data": image["data"]}}
                for image in images
            ] + [{"type": "text", "text": prompt}]
        payload = {
            "model": self.model,
            "max_tokens": self.settings.ai_max_output_tokens,
            "system": system,
            "messages": [{"role": "user", "content": message_content}],
            "stream": True,
        }
        input_tokens = 0
        output_tokens = 0
        try:
            async with httpx.AsyncClient(timeout=_timeouts(self.settings)) as client:
                async with client.stream("POST", "https://api.anthropic.com/v1/messages", headers=headers, json=payload) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        raise ProviderError(self.name, f"http_{response.status_code}", "Anthropic request failed.", retryable=response.status_code in {408, 409, 429, 529} or response.status_code >= 500)
                    yield ProviderEvent("meta", self.name, self.model)
                    async for event in _sse_json(response):
                        event_type = event.get("type")
                        if event_type == "message_start":
                            input_tokens = int((event.get("message", {}).get("usage") or {}).get("input_tokens") or 0)
                        elif event_type == "content_block_delta" and (event.get("delta") or {}).get("type") == "text_delta":
                            yield ProviderEvent("delta", self.name, self.model, text=(event.get("delta") or {}).get("text", ""))
                        elif event_type == "message_delta":
                            output_tokens = int((event.get("usage") or {}).get("output_tokens") or output_tokens)
                        elif event_type == "error":
                            error = event.get("error") or {}
                            raise ProviderError(self.name, str(error.get("type") or "stream_error"), "Anthropic stream failed.")
                    yield ProviderEvent("usage", self.name, self.model, input_tokens=input_tokens, output_tokens=output_tokens)
        except ProviderError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            raise ProviderError(self.name, "network_timeout", "Anthropic did not respond in time.", retryable=True) from error


class OpenAIEmbeddings:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    async def create(self, texts: list[str]) -> EmbeddingResult:
        if not self.settings.openai_api_key:
            raise ProviderError("openai", "embeddings_not_configured", "OpenAI embeddings are not configured.")
        headers = {"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"}
        payload = {"model": self.settings.openai_embedding_model, "input": texts, "encoding_format": "float"}
        try:
            async with httpx.AsyncClient(timeout=_timeouts(self.settings)) as client:
                response = await client.post("https://api.openai.com/v1/embeddings", headers=headers, json=payload)
            if response.status_code >= 400:
                raise ProviderError("openai", f"http_{response.status_code}", "OpenAI embeddings request failed.", retryable=response.status_code in {408, 409, 429} or response.status_code >= 500)
            body = response.json()
            vectors = [item["embedding"] for item in sorted(body.get("data", []), key=lambda item: item["index"])]
            if len(vectors) != len(texts):
                raise ProviderError("openai", "invalid_embedding_response", "OpenAI returned incomplete embeddings.")
            return EmbeddingResult(vectors=vectors, input_tokens=int((body.get("usage") or {}).get("total_tokens") or 0))
        except ProviderError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            raise ProviderError("openai", "network_timeout", "OpenAI embeddings did not respond in time.", retryable=True) from error


class OpenAIImageGenerator:
    name = "openai"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.model = self.settings.openai_image_model

    async def generate(self, prompt: str) -> ImageGenerationResult:
        if not self.settings.openai_api_key:
            raise ProviderError(self.name, "not_configured", "OpenAI image generation is not configured.")
        headers = {"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "prompt": prompt, "size": "1024x1024", "quality": "low", "n": 1}
        try:
            async with httpx.AsyncClient(timeout=_timeouts(self.settings)) as client:
                response = await client.post("https://api.openai.com/v1/images/generations", headers=headers, json=payload)
            if response.status_code >= 400:
                raise ProviderError(self.name, f"http_{response.status_code}", "OpenAI image generation failed.", retryable=response.status_code in {408, 409, 429} or response.status_code >= 500)
            encoded = str(((response.json().get("data") or [{}])[0]).get("b64_json") or "")
            if not encoded:
                raise ProviderError(self.name, "invalid_image_response", "OpenAI returned no image.")
            return ImageGenerationResult(image_bytes=base64.b64decode(encoded), model=self.model)
        except ProviderError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            raise ProviderError(self.name, "network_timeout", "OpenAI image generation did not respond in time.", retryable=True) from error


class AIProviderRouter:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _providers(self, question: str, *, use_web_search: bool = False):
        lowered = question.lower()
        complex_markers = ("analyse", "analyze", "compare", "strategy", "calculate", "deep", "detailed", "risk", "forecast", "formulation")
        simple = len(question) <= 180 and not any(marker in lowered for marker in complex_markers)
        complex_request = len(question) > 600 or any(marker in lowered for marker in complex_markers)
        openai = OpenAIProvider(self.settings)
        sonnet = AnthropicProvider(self.settings, self.settings.anthropic_default_model)
        haiku = AnthropicProvider(self.settings, self.settings.anthropic_fast_model)
        if use_web_search:
            return [openai] if openai.available else []
        if complex_request and openai.available:
            primary = openai
        elif self.settings.ai_default_provider.lower() == "anthropic" and sonnet.available:
            primary = haiku if simple else sonnet
        elif openai.available:
            primary = openai
        elif sonnet.available:
            primary = haiku if simple else sonnet
        else:
            return []
        fallback = openai if primary.name == "anthropic" else sonnet
        return [primary] + ([fallback] if fallback.available and (fallback.name, fallback.model) != (primary.name, primary.model) else [])

    async def stream(self, system: str, prompt: str, question: str, *, use_web_search: bool = False, images: list[dict[str, str]] | None = None) -> AsyncIterator[ProviderEvent]:
        providers = self._providers(question, use_web_search=use_web_search)
        if not providers:
            raise ProviderError("router", "no_provider", "No AI provider is configured.")
        last_error: ProviderError | None = None
        for provider_index, provider in enumerate(providers):
            attempts = 2 if provider_index == 0 else 1
            for attempt in range(attempts):
                emitted_text = False
                try:
                    if isinstance(provider, OpenAIProvider):
                        event_stream = provider.stream(system, prompt, use_web_search=use_web_search, images=images)
                    else:
                        event_stream = provider.stream(system, prompt, images=images)
                    async for event in event_stream:
                        if event.kind == "delta" and event.text:
                            emitted_text = True
                        yield event
                    return
                except ProviderError as error:
                    last_error = error
                    if emitted_text or not error.retryable:
                        raise
                    if attempt + 1 < attempts:
                        await asyncio.sleep(0.4 * (attempt + 1))
                        continue
                    break
        raise last_error or ProviderError("router", "unavailable", "AI providers are unavailable.")


def estimate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    if provider == "openai" and model == "text-embedding-3-small":
        return input_tokens * 0.02 / 1_000_000
    if provider == "openai":
        return (input_tokens * 5.0 + output_tokens * 30.0) / 1_000_000
    if "haiku" in model:
        return (input_tokens * 1.0 + output_tokens * 5.0) / 1_000_000
    return (input_tokens * 3.0 + output_tokens * 15.0) / 1_000_000
