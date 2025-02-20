CREATE TABLE "knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"embeddings_id" uuid NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"approved" boolean DEFAULT false NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
