create extension if not exists pgcrypto;

create type public.account_role as enum ('citizen', 'government_admin', 'finance_officer');
create type public.application_status as enum (
  'payment_required',
  'under_review',
  'approved',
  'rejected',
  'paid'
);
create type public.invoice_status as enum ('unpaid', 'paid', 'cancelled');
create type public.payment_status as enum ('pending', 'successful', 'failed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  account_role public.account_role not null default 'citizen',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  category text not null check (char_length(category) between 1 and 80),
  description text not null,
  fee_minor_units integer not null check (fee_minor_units >= 0 and fee_minor_units % 100 = 0),
  currency char(3) not null default 'ZMW' check (currency = 'ZMW'),
  processing_time text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('APP-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12))),
  user_id uuid not null references public.profiles (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  applicant_name text not null check (char_length(applicant_name) between 1 and 160),
  applicant_email text not null check (char_length(applicant_email) <= 320),
  applicant_phone text not null check (char_length(applicant_phone) between 5 and 32),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  status public.application_status not null default 'payment_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('INV-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12))),
  application_id uuid not null unique references public.applications (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount_minor_units integer not null check (amount_minor_units >= 0 and amount_minor_units % 100 = 0),
  currency char(3) not null default 'ZMW' check (currency = 'ZMW'),
  status public.invoice_status not null default 'unpaid',
  due_at timestamptz not null default now() + interval '14 days',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  provider text not null default 'flutterwave' check (provider = 'flutterwave'),
  provider_transaction_id text unique,
  amount_minor_units integer not null check (amount_minor_units >= 0 and amount_minor_units % 100 = 0),
  currency char(3) not null default 'ZMW' check (currency = 'ZMW'),
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_user_created_idx on public.applications (user_id, created_at desc);
create index invoices_user_created_idx on public.invoices (user_id, created_at desc);
create index payments_user_created_idx on public.payments (user_id, created_at desc);

create function public.current_account_role()
returns public.account_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.account_role
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, new.phone, 'Account holder'), '@', 1), ''),
      'Account holder'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create function public.submit_application(
  p_service_id uuid,
  p_applicant_name text,
  p_applicant_email text,
  p_applicant_phone text,
  p_details jsonb
)
returns table (
  application_id uuid,
  application_reference text,
  invoice_id uuid,
  invoice_reference text,
  amount_minor_units integer,
  currency char(3)
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_service public.services%rowtype;
  v_application public.applications%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and active = true;

  if not found then
    raise exception 'Service is not available';
  end if;

  insert into public.applications (
    user_id, service_id, applicant_name, applicant_email, applicant_phone, details
  )
  values (
    v_user_id, v_service.id, trim(p_applicant_name), lower(trim(p_applicant_email)),
    trim(p_applicant_phone), coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_application;

  insert into public.invoices (application_id, user_id, amount_minor_units, currency)
  values (
    v_application.id, v_user_id, v_service.fee_minor_units, v_service.currency
  )
  returning * into v_invoice;

  return query select
    v_application.id, v_application.reference, v_invoice.id, v_invoice.reference,
    v_invoice.amount_minor_units, v_invoice.currency;
end;
$$;

create function public.begin_payment_checkout(
  p_application_id uuid,
  p_payment_reference text
)
returns table (
  payment_id uuid,
  invoice_id uuid,
  invoice_reference text,
  amount_minor_units integer,
  currency char(3),
  applicant_name text,
  applicant_email text,
  applicant_phone text,
  mobile_money_network text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_application public.applications%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_application
  from public.applications
  where id = p_application_id and user_id = v_user_id
  for update;

  if not found or v_application.status not in ('payment_required', 'approved') then
    raise exception 'Application is not payable';
  end if;

  select * into v_invoice
  from public.invoices
  where application_id = v_application.id and user_id = v_user_id
  for update;

  if not found or v_invoice.status <> 'unpaid' then
    raise exception 'Invoice is not payable';
  end if;

  if coalesce(v_application.details ->> 'mobileMoneyNetwork', '') not in ('MTN', 'Airtel', 'Zamtel') then
    raise exception 'A valid Zambia mobile money network is required';
  end if;

  if exists (
    select 1 from public.payments
    where invoice_id = v_invoice.id
      and status = 'pending'
      and created_at > now() - interval '30 minutes'
  ) then
    raise exception 'A payment attempt is already in progress';
  end if;

  insert into public.payments (
    reference, invoice_id, user_id, amount_minor_units, currency
  )
  values (
    p_payment_reference, v_invoice.id, v_user_id,
    v_invoice.amount_minor_units, v_invoice.currency
  )
  returning * into v_payment;

  return query select
    v_payment.id, v_invoice.id, v_invoice.reference,
    v_invoice.amount_minor_units, v_invoice.currency,
    v_application.applicant_name, v_application.applicant_email, v_application.applicant_phone,
    v_application.details ->> 'mobileMoneyNetwork';
end;
$$;

create function public.complete_flutterwave_payment(
  p_payment_reference text,
  p_provider_transaction_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
begin
  select * into v_payment
  from public.payments
  where reference = p_payment_reference
  for update;

  if not found then
    return false;
  end if;
  if v_payment.status = 'successful' then
    return true;
  end if;
  if v_payment.status <> 'pending' then
    return false;
  end if;

  select * into v_invoice
  from public.invoices
  where id = v_payment.invoice_id
  for update;

  if not found or v_invoice.status <> 'unpaid'
     or v_invoice.amount_minor_units <> v_payment.amount_minor_units
     or v_invoice.currency <> v_payment.currency then
    return false;
  end if;

  perform 1
  from public.applications
  where id = v_invoice.application_id
    and status in ('payment_required', 'approved')
  for update;
  if not found then
    return false;
  end if;

  update public.payments
  set status = 'successful',
      provider_transaction_id = p_provider_transaction_id,
      updated_at = now()
  where id = v_payment.id;

  update public.invoices
  set status = 'paid', paid_at = now()
  where id = v_invoice.id;

  update public.applications
  set status = 'paid', updated_at = now()
  where id = v_invoice.application_id
    and status in ('payment_required', 'approved');

  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.applications enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

revoke all on public.profiles, public.services, public.applications, public.invoices, public.payments from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.services to anon, authenticated;
grant select on public.applications, public.invoices, public.payments to authenticated;
grant insert, update, delete on public.services to authenticated;
grant execute on function public.submit_application(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.begin_payment_checkout(uuid, text) to authenticated;
grant execute on function public.complete_flutterwave_payment(text, text) to service_role;

create policy "Users can read their profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select public.current_account_role()) in ('government_admin', 'finance_officer'));
create policy "Users can update their own name"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and account_role = (select public.current_account_role())
  );

create policy "Anyone can read active services"
  on public.services for select to anon, authenticated
  using (active = true or (select public.current_account_role()) in ('government_admin', 'finance_officer'));
create policy "Government admins can manage services"
  on public.services for all to authenticated
  using ((select public.current_account_role()) = 'government_admin')
  with check ((select public.current_account_role()) = 'government_admin');

create policy "Users can read their own applications"
  on public.applications for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.current_account_role()) in ('government_admin', 'finance_officer')
  );
create policy "Users can read their own invoices"
  on public.invoices for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.current_account_role()) in ('government_admin', 'finance_officer')
  );
create policy "Users can read their own payments"
  on public.payments for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.current_account_role()) in ('government_admin', 'finance_officer')
  );

grant usage on schema public to anon, authenticated;
grant usage on type public.account_role, public.application_status, public.invoice_status, public.payment_status to authenticated;
