CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"grader_model" text NOT NULL,
	"positions" integer NOT NULL,
	"score" real NOT NULL,
	"results" jsonb NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"fen" text NOT NULL,
	"played_uci" text NOT NULL,
	"level" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"theme" text,
	"text" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explanations_fen_played_uci_level_prompt_version_pk" PRIMARY KEY("fen","played_uci","level","prompt_version")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"pgn" text NOT NULL,
	"white" text,
	"black" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
