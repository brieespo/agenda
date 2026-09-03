-- Which product she used for a step, alongside whether she did it.
--
-- A sibling column rather than a reshape of done_steps. That column is an array
-- of step ids and every reader in the app treats it as one — doneSteps(),
-- routineComplete(), the focus-mode resume. Turning its elements into objects
-- would have meant migrating every existing row and breaking any build that
-- had not caught up; a new column that older builds simply never write is
-- invisible to them.
--
-- Shape: {"<step id>": "<4-char product key>"}. The key points into
-- settings.skincare.products, the same library the skincare tracker has always
-- used, which is what lets a step's history join up with what that tracker
-- already recorded. Keys, not names: a renamed product keeps its history.
--
-- Steps with no product attached never appear here, so a routine that is just a
-- checklist costs nothing.
--
-- Not a foreign key, and not validated: the catalog lives in a JSON column, and
-- a key whose product was deleted should read as "something she used and later
-- removed" rather than block the write.

alter table public.routine_progress
  add column if not exists choices jsonb not null default '{}'::jsonb;

comment on column public.routine_progress.choices is
  'step id -> product key (settings.skincare.products[].k) used for that step that day';
