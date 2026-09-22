-- CreateTable
CREATE TABLE "agent_chat_threads" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "last_preview" TEXT,
    "last_read_at" TIMESTAMP(3),
    "pending_message_id" TEXT,
    "pending_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_chat_messages" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "thread_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "reason" TEXT,
    "error_message" TEXT,
    "trace" JSONB,
    "model" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_chat_threads_user_id_last_message_at_idx" ON "agent_chat_threads"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "agent_chat_threads_space_id_agent_name_idx" ON "agent_chat_threads"("space_id", "agent_name");

-- CreateIndex
CREATE UNIQUE INDEX "agent_chat_threads_space_id_agent_name_user_id_key" ON "agent_chat_threads"("space_id", "agent_name", "user_id");

-- CreateIndex
CREATE INDEX "agent_chat_messages_thread_id_created_at_idx" ON "agent_chat_messages"("thread_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "agent_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The two enumerated columns are held by the database too.
ALTER TABLE "agent_chat_messages"
    ADD CONSTRAINT "agent_chat_messages_role_check" CHECK ("role" IN ('user', 'assistant'));
ALTER TABLE "agent_chat_messages"
    ADD CONSTRAINT "agent_chat_messages_status_check" CHECK ("status" IN ('pending', 'done', 'failed'));
