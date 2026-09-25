-- An agent's inputs: declared on the record, each identity holding its own values.
ALTER TABLE "agent_state" ADD COLUMN "inputs" JSONB;
ALTER TABLE "agent_state" ADD COLUMN "input_values" JSONB;
ALTER TABLE "agent_subscriptions" ADD COLUMN "inputs" JSONB;
