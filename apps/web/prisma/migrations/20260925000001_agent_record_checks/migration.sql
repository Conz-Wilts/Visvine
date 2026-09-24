-- The record's enum-ish columns take only the values the parsers produce.
ALTER TABLE "agent_state"
    ADD CONSTRAINT "agent_state_share_mode_check" CHECK ("share_mode" IN ('none', 'all', 'rooms'));
ALTER TABLE "agent_state"
    ADD CONSTRAINT "agent_state_share_as_check" CHECK ("share_as" IN ('use', 'run-in'));
