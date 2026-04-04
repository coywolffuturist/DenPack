-- Migration 002: add flag column to pack_scores for low-confidence routing signals
ALTER TABLE pack_scores ADD COLUMN IF NOT EXISTS flag TEXT;
