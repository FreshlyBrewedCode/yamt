-- #9: how a transcript was made, for comparing STT settings later (spike #4, phase 2):
-- the transcription's wall time and the settings the STT process ran with (JSON object).
ALTER TABLE transcripts ADD COLUMN elapsed_ms INTEGER;
ALTER TABLE transcripts ADD COLUMN settings TEXT;
