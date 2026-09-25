-- The records layer: notes that declare a member-invented type, and their typed field values (lib/records/).

-- CreateTable
CREATE TABLE "context_records" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_record_fields" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text_value" TEXT,
    "number_value" DOUBLE PRECISION,
    "date_value" TIMESTAMP(3),
    "bool_value" BOOLEAN,
    "raw" TEXT,
    "invalid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "context_record_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "context_records_space_id_owner_key_type_idx" ON "context_records"("space_id", "owner_key", "type");

-- CreateIndex
CREATE UNIQUE INDEX "context_records_space_id_owner_key_path_key" ON "context_records"("space_id", "owner_key", "path");

-- CreateIndex
CREATE INDEX "context_record_fields_space_id_owner_key_type_key_idx" ON "context_record_fields"("space_id", "owner_key", "type", "key");

-- CreateIndex
CREATE UNIQUE INDEX "context_record_fields_space_id_owner_key_path_key_key" ON "context_record_fields"("space_id", "owner_key", "path", "key");

-- AddForeignKey
ALTER TABLE "context_records" ADD CONSTRAINT "context_records_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_record_fields" ADD CONSTRAINT "context_record_fields_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

