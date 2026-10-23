ALTER TABLE "invitation" RENAME COLUMN "token" TO "token_hash";--> statement-breakpoint
-- Hash the outstanding invitation tokens in place so their links keep working.
-- Same encoding as hashToken() in src/server/security/token-hash.ts: SHA-256 of
-- the UTF-8 bytes, as lowercase hex.
UPDATE "invitation" SET "token_hash" = encode(sha256(convert_to("token_hash", 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_token_unique";--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash");
