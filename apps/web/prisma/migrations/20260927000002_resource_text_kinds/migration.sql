-- A PDF and a slide deck are text sources now (lib/notes/sources/extract.ts).
ALTER TABLE "context_sources" DROP CONSTRAINT "context_sources_kind_check";
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_kind_check"
  CHECK ("kind" IN ('csv', 'markdown', 'text', 'json', 'docx', 'spreadsheet', 'pdf', 'slides')) NOT VALID;
