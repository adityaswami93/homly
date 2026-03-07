-- Migration: 015_insurance_policies.sql
-- Creates the insurance_policies table for multi-tenant household insurance tracking.

create table if not exists insurance_policies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  provider text not null,
  policy_number text,
  coverage_type text not null check (coverage_type in ('health', 'life', 'home', 'car', 'travel', 'other')),
  insured_person text,
  coverage_amount numeric,
  premium_amount numeric,
  premium_frequency text check (premium_frequency in ('monthly', 'quarterly', 'annually')),
  renewal_date date,
  notes text,
  is_active boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table insurance_policies enable row level security;

-- Members can view their household's policies
create policy "household members can view policies"
  on insurance_policies for select
  using (
    household_id in (
      select household_id from household_members where user_id = auth.uid()
    )
  );

-- Admins and owners can manage (insert, update, delete) policies
create policy "household admins can manage policies"
  on insurance_policies for all
  using (
    household_id in (
      select household_id from household_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Index for efficient household + active queries
create index if not exists insurance_policies_household_active
  on insurance_policies (household_id, is_active, renewal_date);
