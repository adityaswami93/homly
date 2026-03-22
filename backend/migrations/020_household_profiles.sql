create table if not exists household_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references households(id) on delete cascade,
  primary_age int,
  marital_status text check (marital_status in ('single', 'married', 'divorced', 'widowed')),
  num_children int default 0,
  has_elderly_dependants boolean default false,
  employment_type text check (employment_type in ('employed', 'self_employed', 'unemployed', 'retired')),
  has_mortgage boolean default false,
  owns_car boolean default false,
  residency_status text check (residency_status in ('citizen', 'pr', 'expat')),
  updated_at timestamptz default now()
);

alter table household_profiles enable row level security;

create policy "household members can view profile"
  on household_profiles for select
  using (
    household_id in (
      select household_id from household_members where user_id = auth.uid()
    )
  );

create policy "household admins can manage profile"
  on household_profiles for all
  using (
    household_id in (
      select household_id from household_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create index if not exists household_profiles_household_id
  on household_profiles (household_id);
