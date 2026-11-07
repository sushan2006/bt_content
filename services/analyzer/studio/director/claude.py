"""Small client for the Anthropic Messages API: prompt caching, images, web search, retries, cost tracking, budget cap.

The API key is read from the environment (ANTHROPIC_API_KEY in the repository's .env). It is never logged.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import time
from typing import Any, Callable, Optional

import httpx

API = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/") + "/v1/messages"
VERSION = "2023-06-01"

# USD per million tokens: input, output, cache write, cache read (Claude API list prices, Nov 2026)
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 5.0, 0.20),
    "claude-sonnet-5-5": (2.0, 10.0, 2.5, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
    "claude-fable-5-1": (10.0, 50.0, 12.5, 1.0),
}
WEB_SEARCH_PER_1000 = 10.0


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


class BudgetExceeded(Exception):
    pass


class ClaudeError(Exception):
    pass


class Usage:
    def __init__(self, budget_usd: Optional[float] = None):
        self.budget = budget_usd
        self.calls: list[dict] = []

    def add(self, model: str, step: str, u: dict) -> dict:
        pin, pout, pcw, pcr = PRICES.get(model, PRICES["claude-sonnet-5-5"])
        searches = int(((u.get("server_tool_use") or {}).get("web_search_requests")) or 0)
        row = {"step": step, "model": model, "input": int(u.get("input_tokens") or 0), "output": int(u.get("output_tokens") or 0),
               "cache_write": int(u.get("cache_creation_input_tokens") or 0), "cache_read": int(u.get("cache_read_input_tokens") or 0), "searches": searches}
        row["cost_usd"] = round((row["input"] * pin + row["output"] * pout + row["cache_write"] * pcw + row["cache_read"] * pcr) / 1e6 + searches * WEB_SEARCH_PER_1000 / 1000, 4)
        self.calls.append(row)
        return row

    @property
    def cost(self) -> float:
        return round(sum(c["cost_usd"] for c in self.calls), 4)

    def check(self, reserve: float = 0.0) -> None:
        if self.budget is not None and self.cost + reserve > self.budget:
            raise BudgetExceeded(f"budget of ${self.budget:.2f} reached (spent ${self.cost:.2f})")

    def summary(self) -> dict:
        tot = {k: sum(c[k] for c in self.calls) for k in ("input", "output", "cache_write", "cache_read", "searches")}
        return {"cost_usd": self.cost, "budget_usd": self.budget, "calls": self.calls, **tot}


def image_block(path: str, max_side: int = 1400, quality: int = 82) -> dict:
    from PIL import Image
    im = Image.open(path).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}


def text_block(text: str, cache: bool = False) -> dict:
    b = {"type": "text", "text": text}
    if cache:
        b["cache_control"] = {"type": "ephemeral"}
    return b


def extract_json(text: str) -> Any:
    """The last JSON object in the reply (inside ```json fences or bare)."""
    fences = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    for raw in reversed(fences):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            continue
    a, b = text.find("{"), text.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(text[a:b + 1])
        except json.JSONDecodeError as e:
            raise ClaudeError(f"Claude's reply was not valid JSON: {e}") from e
    raise ClaudeError("Claude's reply had no JSON")


class Claude:
    def __init__(self, usage: Usage, log: Callable[[str], None] = lambda m: None, timeout: float = 600):
        self.key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not self.key:
            raise ClaudeError("ANTHROPIC_API_KEY is not set in .env")
        self.usage = usage
        self.log = log
        self.timeout = timeout
        self.search_tool = os.environ.get("ANTHROPIC_WEB_SEARCH_TOOL", "web_search_20250305")

    def _post(self, body: dict) -> dict:
        delay = 4.0
        for attempt in range(6):
            try:
                r = httpx.post(API, timeout=self.timeout, json=body,
                               headers={"x-api-key": self.key, "anthropic-version": VERSION, "content-type": "application/json"})
            except httpx.HTTPError as e:
                if attempt == 5:
                    raise ClaudeError(f"could not reach the Claude API: {e}") from e
                time.sleep(delay)
                delay *= 1.8
                continue
            if r.status_code in (429, 500, 502, 503, 529):
                if attempt == 5:
                    raise ClaudeError(f"Claude API busy ({r.status_code})")
                wait = float(r.headers.get("retry-after") or delay)
                self.log(f"Claude is busy, retrying in {wait:.0f} s")
                time.sleep(min(wait, 60))
                delay *= 1.8
                continue
            if r.status_code >= 400:
                try:
                    msg = r.json().get("error", {}).get("message", r.text)
                except Exception:  # noqa: BLE001
                    msg = r.text
                if r.status_code == 401:
                    msg = "the API key in .env was not accepted (ANTHROPIC_API_KEY)"
                raise ClaudeError(f"Claude API error {r.status_code}: {msg[:400]}")
            return r.json()
        raise ClaudeError("Claude API did not answer")

    def ask(self, step: str, model: str, system: list[dict] | str, messages: list[dict], max_tokens: int = 8000,
            web_search: int = 0, reserve: float = 0.05) -> tuple[str, list[dict], dict]:
        """One turn (server tools such as web search may continue it). Returns (text, the assistant content, usage row)."""
        self.usage.check(reserve)
        body: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages}
        if web_search:
            body["tools"] = [{"type": self.search_tool, "name": "web_search", "max_uses": web_search}]
        content: list[dict] = []
        total = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "server_tool_use": {"web_search_requests": 0}}
        msgs = list(messages)
        for _ in range(6):
            try:
                data = self._post(dict(body, messages=msgs))
            except ClaudeError as e:
                if web_search and ("tool" in str(e).lower() or "web_search" in str(e).lower()):
                    self.log("Web search is not available on this API key; Claude researches from what it knows")
                    body.pop("tools", None)
                    web_search = 0
                    data = self._post(dict(body, messages=msgs))
                else:
                    raise
            u = data.get("usage") or {}
            for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"):
                total[k] += int(u.get(k) or 0)
            total["server_tool_use"]["web_search_requests"] += int(((u.get("server_tool_use") or {}).get("web_search_requests")) or 0)
            content += data.get("content") or []
            if data.get("stop_reason") == "pause_turn":       # long server-tool turn: continue it
                msgs = msgs + [{"role": "assistant", "content": data.get("content") or []}]
                continue
            if data.get("stop_reason") == "max_tokens":
                self.log(f"{step}: Claude's answer hit the length limit")
            break
        row = self.usage.add(model, step, total)
        text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
        return text, content, row

    def ask_json(self, step: str, model: str, system, messages: list[dict], max_tokens: int = 8000, web_search: int = 0,
                 check: Optional[Callable[[Any], list[str]]] = None, retries: int = 2) -> tuple[Any, list[dict]]:
        """Asks for JSON; when `check` returns problems they are sent back to Claude to fix (up to `retries` times).
        Returns (json, the conversation so far)."""
        msgs = list(messages)
        last_err = ""
        for attempt in range(retries + 1):
            text, content, row = self.ask(step if attempt == 0 else f"{step} (fix {attempt})", model, system, msgs, max_tokens, web_search if attempt == 0 else 0)
            self.log(f"{step}: {row['input'] + row['cache_read'] + row['cache_write']:,} tokens in, {row['output']:,} out (${row['cost_usd']:.3f})")
            asst = [{"type": "text", "text": text or "{}"}]
            try:
                obj = extract_json(text)
                problems = check(obj) if check else []
            except ClaudeError as e:
                obj, problems = None, [str(e)]
            msgs = msgs + [{"role": "assistant", "content": asst}]
            if not problems:
                return obj, msgs
            last_err = "; ".join(problems)[:300]
            if attempt == retries:
                break
            self.log(f"{step}: asking Claude to fix {len(problems)} problem(s)")
            msgs = msgs + [{"role": "user", "content": [text_block("Your JSON has these problems. Fix all of them and reply with the complete corrected JSON only:\n- " + "\n- ".join(problems[:25]))]}]
        if obj is not None:
            return obj, msgs   # the caller decides what to do with what is still wrong (the compiler drops bad beats)
        raise ClaudeError(f"{step}: no usable answer ({last_err})")
