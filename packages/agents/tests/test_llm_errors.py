from arete_agents.llm.errors import classify_provider_error


class _StatusError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def test_credit_balance_is_non_retryable_and_actionable():
    exc = _StatusError(
        "Error code: 400 - {'error': {'message': 'Your credit balance is too low to access the Anthropic API.'}}",
        status_code=400,
    )
    err = classify_provider_error(exc)
    assert err.kind == "credit_balance"
    assert err.retryable is False
    assert "credits" in err.message.lower()


def test_invalid_api_key_is_non_retryable():
    err = classify_provider_error(_StatusError("invalid x-api-key", status_code=401))
    assert err.kind == "invalid_api_key"
    assert err.retryable is False


def test_model_not_found_is_non_retryable():
    err = classify_provider_error(_StatusError("model not found", status_code=404))
    assert err.kind == "model_not_found"
    assert err.retryable is False


def test_rate_limit_is_retryable():
    err = classify_provider_error(_StatusError("rate limit exceeded", status_code=429))
    assert err.kind == "rate_limit"
    assert err.retryable is True


def test_transient_5xx_is_retryable():
    err = classify_provider_error(_StatusError("bad gateway", status_code=502))
    assert err.kind == "transient"
    assert err.retryable is True


def test_unknown_error_surfaces_raw_message_and_does_not_retry():
    err = classify_provider_error(ValueError("something odd happened"))
    assert err.kind == "unknown"
    assert err.retryable is False
    assert "something odd" in err.message
