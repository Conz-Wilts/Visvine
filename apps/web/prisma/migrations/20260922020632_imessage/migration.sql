-- CreateTable
CREATE TABLE "imessage_lines" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "profile_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imessage_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imessage_links" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imessage_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imessage_threads" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "line_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imessage_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imessage_inbound" (
    "handle" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imessage_inbound_pkey" PRIMARY KEY ("handle")
);

-- CreateIndex
CREATE UNIQUE INDEX "imessage_lines_space_id_key" ON "imessage_lines"("space_id");

-- CreateIndex
CREATE UNIQUE INDEX "imessage_lines_number_key" ON "imessage_lines"("number");

-- CreateIndex
CREATE UNIQUE INDEX "imessage_links_phone_key" ON "imessage_links"("phone");

-- CreateIndex
CREATE INDEX "imessage_links_user_id_idx" ON "imessage_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "imessage_threads_line_id_phone_key" ON "imessage_threads"("line_id", "phone");

-- CreateIndex
CREATE INDEX "imessage_inbound_received_at_idx" ON "imessage_inbound"("received_at");

-- AddForeignKey
ALTER TABLE "imessage_lines" ADD CONSTRAINT "imessage_lines_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imessage_links" ADD CONSTRAINT "imessage_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imessage_threads" ADD CONSTRAINT "imessage_threads_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "imessage_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imessage_threads" ADD CONSTRAINT "imessage_threads_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The line's status enumerates its values; the database says so too.
ALTER TABLE "imessage_lines"
    ADD CONSTRAINT "imessage_lines_status_check" CHECK ("status" IN ('active', 'suspended'));
