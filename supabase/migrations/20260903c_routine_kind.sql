-- What a routine's steps log: products, or exercises.
--
-- On the card rather than on each step. A card is one activity — a skincare
-- routine and a workout are never the same card — so asking per step meant
-- every step carried a mode toggle to answer something the card already knew,
-- and a card could be built that mixed the two with no coherent meaning for
-- what ticking a step did.
--
-- It also lets a whole run be coherent: focus mode on a workout asks for
-- numbers throughout instead of changing character from step to step.
--
-- Defaulted rather than backfilled: 'products' is what every routine that
-- already exists is, and a default means no UPDATE has to touch them. An older
-- build that never writes this column simply keeps sending the other fields,
-- and its routines stay products routines.
--
-- Which exercise a step logs stays in steps[].exercise, where it already lives
-- — the kind says how to read the card, not what each step points at.

alter table public.routines
  add column if not exists kind text not null default 'products';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'routines_kind_valid'
  ) then
    alter table public.routines
      add constraint routines_kind_valid check (kind in ('products', 'exercise'));
  end if;
end $$;

comment on column public.routines.kind is
  'products = steps pick from settings.skincare.products; exercise = steps log activity_events';
