ALTER TABLE "knowledge" ALTER COLUMN "embeddings_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "knowledge" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge" ADD COLUMN "no_of_chunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_id_idx" ON "knowledge" USING btree ("embeddings_id");--> statement-breakpoint
CREATE INDEX "created_at_idx" ON "knowledge" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_embeddings_id_unique" UNIQUE("embeddings_id");