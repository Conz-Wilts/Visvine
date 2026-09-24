-- OpenRouter is no longer an agent model provider, so its catalogue's price rows
-- answer no brief. The nightly sync now reads LiteLLM alone.
DELETE FROM "agent_model_prices" WHERE "source" = 'openrouter';
