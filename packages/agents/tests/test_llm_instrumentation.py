"""LLM instrumentation wiring: one hook per layer, never doubled; broken
instrumentation loses spans, never the service."""

import builtins
import sys
import types

from langchain_openai import ChatOpenAI

import arete_agents.observability as obs
from arete_agents.llm.ollama import DEFAULT_OLLAMA_MODEL, build_ollama_llm


def _fake_module(mod_name: str, cls_name: str, calls: list[str]) -> types.ModuleType:
    mod = types.ModuleType(mod_name)

    class _Instr:
        def instrument(self):
            calls.append(cls_name)

    setattr(mod, cls_name, _Instr)
    return mod


def test_instrument_llm_layers_calls_all_four(monkeypatch):
    calls: list[str] = []
    for mod_name, cls_name in (
        ("opentelemetry.instrumentation.anthropic", "AnthropicInstrumentor"),
        ("opentelemetry.instrumentation.google_genai", "GoogleGenAiSdkInstrumentor"),
        ("opentelemetry.instrumentation.openai_v2", "OpenAIInstrumentor"),
        ("opentelemetry.instrumentation.langchain", "LangchainInstrumentor"),
    ):
        monkeypatch.setitem(sys.modules, mod_name, _fake_module(mod_name, cls_name, calls))
    obs._instrument_llm_layers()
    assert calls == [
        "AnthropicInstrumentor",
        "GoogleGenAiSdkInstrumentor",
        "OpenAIInstrumentor",
        "LangchainInstrumentor",
    ]


def test_instrument_llm_layers_never_raises(monkeypatch):
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name.startswith("opentelemetry.instrumentation."):
            raise ImportError(f"forced failure for {name}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)
    obs._instrument_llm_layers()  # must not raise


def test_ollama_rides_the_openai_compatible_endpoint():
    llm = build_ollama_llm()
    # ChatOpenAI => the official openai-v2 genai instrumentation covers Ollama
    # (there is no Ollama-native instrumentation; never two hooks per layer).
    assert isinstance(llm, ChatOpenAI)
    assert str(llm.openai_api_base).rstrip("/") == "http://127.0.0.1:11434/v1"
    assert llm.model_name == DEFAULT_OLLAMA_MODEL


def test_ollama_custom_base_url_gets_v1_suffix():
    llm = build_ollama_llm(model="qwen2.5-coder", base_url="http://10.0.0.5:11434/")
    assert str(llm.openai_api_base).rstrip("/") == "http://10.0.0.5:11434/v1"
