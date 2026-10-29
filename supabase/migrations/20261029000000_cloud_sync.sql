-- ---------------------------------------------------------------------------
-- BillingApp cloud sync foundation
--
-- Local SQLite remains the source of truth for the app. This schema stores a
-- replica per shop, a change log for delta sync, and the AI quota used by the
-- Gemini Edge Function.
--
-- All synced tables use (shop_id, id) as their primary key so the same local
-- ids (for example the seeded "pt-001" product type) can exist in every shop.
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Shops and membership
-- ---------------------------------------------------------------------------

create table if not exists public.shops (
  id text primary key,
  name text not null,
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.shop_members (
  shop_id text not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create index if not exists idx_shop_members_user on public.shop_members(user_id);

-- ---------------------------------------------------------------------------
-- Synced catalogue tables
-- ---------------------------------------------------------------------------

create table if not exists public.product_types (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  primary key (shop_id, id)
);

-- Names are intentionally not unique on the server: two offline devices can
-- create the same name with different ids. The client keeps one local row and
-- routes products from the duplicate type to it during pull. Local SQLite still
-- enforces a friendly unique name for the device that created it.
create index if not exists idx_product_types_name
  on public.product_types (shop_id, lower(name));

create table if not exists public.products (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  name text not null,
  type_id text not null,
  brand text,
  colour text,
  cost_price numeric(12, 2) not null default 0,
  price numeric(12, 2) not null default 0,
  barcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  device_id text,
  primary key (shop_id, id),
  constraint products_type_fk
    foreign key (shop_id, type_id)
    references public.product_types(shop_id, id)
);

create unique index if not exists idx_products_barcode
  on public.products (shop_id, barcode)
  where deleted_at is null and barcode is not null;

create index if not exists idx_products_shop_name_trgm
  on public.products using gin (name gin_trgm_ops);

create index if not exists idx_products_shop_type
  on public.products (shop_id, type_id);

create table if not exists public.inventory (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  product_id text not null,
  size text not null,
  quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  primary key (shop_id, id),
  constraint inventory_product_fk
    foreign key (shop_id, product_id)
    references public.products(shop_id, id)
    on delete cascade
);

create unique index if not exists idx_inventory_product_size
  on public.inventory (shop_id, product_id, size)
  where deleted_at is null;

create table if not exists public.customers (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  name text not null,
  phone text,
  total_purchase numeric(12, 2) not null default 0,
  due_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  primary key (shop_id, id)
);

create unique index if not exists idx_customers_phone
  on public.customers (shop_id, phone)
  where deleted_at is null and phone is not null and phone <> '';

create table if not exists public.orders (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  date timestamptz not null default now(),
  customer_id text,
  total_amount numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  final_amount numeric(12, 2) not null default 0,
  payment_mode text not null default 'cash',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  device_id text,
  primary key (shop_id, id),
  constraint orders_customer_fk
    foreign key (shop_id, customer_id)
    references public.customers(shop_id, id)
);

create index if not exists idx_orders_shop_date
  on public.orders (shop_id, date desc);

create table if not exists public.order_items (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  order_id text not null,
  product_id text not null,
  size text not null,
  quantity integer not null default 1,
  price numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (shop_id, id),
  constraint order_items_order_fk
    foreign key (shop_id, order_id)
    references public.orders(shop_id, id)
    on delete cascade,
  constraint order_items_product_fk
    foreign key (shop_id, product_id)
    references public.products(shop_id, id)
);

create index if not exists idx_order_items_order
  on public.order_items (shop_id, order_id);

create table if not exists public.stock_movements (
  shop_id text not null references public.shops(id) on delete cascade,
  id text not null,
  product_id text not null,
  size text not null,
  delta integer not null,
  reason text not null default 'adjustment',
  order_id text,
  device_id text,
  created_at timestamptz not null default now(),
  primary key (shop_id, id),
  constraint stock_movements_product_fk
    foreign key (shop_id, product_id)
    references public.products(shop_id, id)
);

create index if not exists idx_stock_movements_product
  on public.stock_movements (shop_id, product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Sync infrastructure
-- ---------------------------------------------------------------------------

create table if not exists public.change_log (
  seq bigserial primary key,
  shop_id text not null references public.shops(id) on delete cascade,
  entity text not null,
  entity_id text not null,
  op text not null check (op in ('upsert', 'delete')),
  payload jsonb not null,
  actor_id uuid,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_change_log_shop_seq
  on public.change_log (shop_id, seq);

create table if not exists public.sync_mutations (
  mutation_id text primary key,
  shop_id text not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  applied_at timestamptz not null default now()
);

create index if not exists idx_sync_mutations_shop
  on public.sync_mutations (shop_id, applied_at);

create table if not exists public.ai_usage (
  shop_id text not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (shop_id, user_id, day)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_shop_member(p_shop_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members
    where shop_id = p_shop_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_shop_member(text) from public;
grant execute on function public.is_shop_member(text) to authenticated;

-- Keeps updated_at/version server-controlled. Local clocks are never trusted
-- for sync ordering; the change_log sequence is the cursor.
create or replace function public.set_sync_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
  else
    new.version := coalesce(old.version, 0) + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_shop_id text;
  v_entity_id text;
  v_op text;
begin
  if tg_op = 'DELETE' then
    v_payload := to_jsonb(old);
    v_shop_id := old.shop_id;
    v_entity_id := old.id;
    v_op := 'delete';
  else
    v_payload := to_jsonb(new);
    v_shop_id := new.shop_id;
    v_entity_id := new.id;
    v_op := 'upsert';
  end if;

  insert into public.change_log (
    shop_id, entity, entity_id, op, payload, actor_id, device_id
  ) values (
    v_shop_id,
    tg_table_name,
    v_entity_id,
    v_op,
    v_payload,
    auth.uid(),
    nullif(current_setting('app.device_id', true), '')
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shop creation / joining
-- ---------------------------------------------------------------------------

create or replace function public.create_shop(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_shop_id text;
  v_invite text;
  v_name text;
  v_i integer := 1;
  v_names text[] := array[
    'Shirt', 'T-Shirt', 'Jeans', 'Trousers',
    'Saree', 'Kurta', 'Jacket', 'Other'
  ];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'shop name is required' using errcode = '22023';
  end if;

  loop
    v_shop_id := replace(gen_random_uuid()::text, '-', '');
    v_invite := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.shops (id, name, invite_code, owner_id)
      values (v_shop_id, trim(p_name), v_invite, v_user);
      exit;
    exception when unique_violation then
      -- Extremely unlikely id/invite collision: generate another pair.
    end;
  end loop;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_user, 'owner');

  foreach v_name in array v_names loop
    insert into public.product_types (shop_id, id, name)
    values (v_shop_id, 'pt-' || lpad(v_i::text, 3, '0'), v_name)
    on conflict (shop_id, id) do update
      set name = excluded.name,
          deleted_at = null;
    v_i := v_i + 1;
  end loop;

  return jsonb_build_object(
    'id', v_shop_id,
    'name', trim(p_name),
    'invite_code', v_invite
  );
end;
$$;

create or replace function public.join_shop(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_shop public.shops%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_shop
  from public.shops
  where upper(invite_code) = upper(trim(p_invite_code))
    and deleted_at is null;

  if not found then
    raise exception 'invalid invite code' using errcode = '22023';
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop.id, v_user, 'staff')
  on conflict (shop_id, user_id) do nothing;

  return jsonb_build_object(
    'id', v_shop.id,
    'name', v_shop.name,
    'invite_code', v_shop.invite_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delta push
-- ---------------------------------------------------------------------------

create or replace function public.sync_push(
  p_shop_id text,
  p_device_id text,
  p_mutations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_mutation jsonb;
  v_mutation_id text;
  v_entity text;
  v_op text;
  v_payload jsonb;
  v_entity_id text;
  v_type_id text;
  v_name text;
  v_barcode text;
  v_applied text[] := '{}';
  v_skipped integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shop_members
    where shop_id = p_shop_id and user_id = v_user
  ) then
    raise exception 'not a shop member' using errcode = '42501';
  end if;

  -- Serialize pushes per shop. This keeps barcode/name checks deterministic
  -- and preserves change_log order when two devices sync at the same time.
  perform 1 from public.shops where id = p_shop_id for update;

  perform set_config('app.device_id', coalesce(p_device_id, ''), true);

  for v_mutation in
    select value from jsonb_array_elements(coalesce(p_mutations, '[]'::jsonb))
  loop
    v_mutation_id := v_mutation->>'id';
    v_entity := v_mutation->>'entity';
    v_op := coalesce(v_mutation->>'op', 'upsert');
    v_payload := coalesce(v_mutation->'payload', '{}'::jsonb);
    v_entity_id := v_payload->>'id';

    if v_mutation_id is null or v_entity is null or v_entity_id is null then
      raise exception 'invalid mutation' using errcode = '22023';
    end if;

    if exists (
      select 1 from public.sync_mutations where mutation_id = v_mutation_id
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_entity = 'product_types' then
      if v_op = 'delete' or (v_payload ? 'deleted_at' and v_payload->>'deleted_at' is not null) then
        update public.product_types
        set deleted_at = now()
        where shop_id = p_shop_id and id = v_entity_id;
      else
        v_name := trim(coalesce(v_payload->>'name', ''));
        if v_name = '' then
          raise exception 'product type name is required' using errcode = '22023';
        end if;

        insert into public.product_types (shop_id, id, name, created_at)
        values (
          p_shop_id,
          v_entity_id,
          v_name,
          coalesce((v_payload->>'created_at')::timestamptz, now())
        )
        on conflict (shop_id, id) do update
          set name = excluded.name,
              deleted_at = null;
      end if;

    elsif v_entity = 'products' then
      if v_op = 'delete' or (v_payload ? 'deleted_at' and v_payload->>'deleted_at' is not null) then
        update public.products
        set deleted_at = now(),
            barcode = null,
            updated_by = v_user,
            device_id = p_device_id
        where shop_id = p_shop_id and id = v_entity_id;
      else
        v_name := trim(coalesce(v_payload->>'name', ''));
        v_type_id := nullif(v_payload->>'type_id', '');
        v_barcode := nullif(trim(coalesce(v_payload->>'barcode', '')), '');

        if v_name = '' then
          raise exception 'product name is required' using errcode = '22023';
        end if;
        if v_type_id is null then
          raise exception 'product type is required' using errcode = '22023';
        end if;

        -- Barcodes are unique per shop. If another device already owns this
        -- barcode, keep the product but store it without a barcode. The next
        -- pull clears the duplicate locally, so the outbox never gets stuck.
        if v_barcode is not null and exists (
          select 1 from public.products
          where shop_id = p_shop_id
            and barcode = v_barcode
            and id <> v_entity_id
            and deleted_at is null
        ) then
          v_barcode := null;
        end if;

        insert into public.products (
          shop_id, id, name, type_id, brand, colour,
          cost_price, price, barcode, created_at, updated_by, device_id
        ) values (
          p_shop_id,
          v_entity_id,
          v_name,
          v_type_id,
          nullif(v_payload->>'brand', ''),
          nullif(v_payload->>'colour', ''),
          coalesce((v_payload->>'cost_price')::numeric, 0),
          coalesce((v_payload->>'price')::numeric, 0),
          v_barcode,
          coalesce((v_payload->>'created_at')::timestamptz, now()),
          v_user,
          p_device_id
        )
        on conflict (shop_id, id) do update
          set name = excluded.name,
              type_id = excluded.type_id,
              brand = excluded.brand,
              colour = excluded.colour,
              cost_price = excluded.cost_price,
              price = excluded.price,
              barcode = excluded.barcode,
              deleted_at = null,
              updated_by = v_user,
              device_id = p_device_id;
      end if;

    else
      raise exception 'unsupported sync entity: %', v_entity using errcode = '22023';
    end if;

    insert into public.sync_mutations (mutation_id, shop_id, user_id)
    values (v_mutation_id, p_shop_id, v_user)
    on conflict (mutation_id) do nothing;

    v_applied := array_append(v_applied, v_mutation_id);
  end loop;

  return jsonb_build_object(
    'applied', to_jsonb(v_applied),
    'skipped', v_skipped
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delta pull
-- ---------------------------------------------------------------------------

create or replace function public.sync_pull(
  p_shop_id text,
  p_since bigint default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
  v_changes jsonb;
  v_next bigint;
  v_count integer;
begin
  if not public.is_shop_member(p_shop_id) then
    raise exception 'not a shop member' using errcode = '42501';
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'seq', seq,
          'entity', entity,
          'op', op,
          'payload', payload
        )
        order by seq
      ),
      '[]'::jsonb
    ),
    coalesce(max(seq), p_since),
    count(*)
  into v_changes, v_next, v_count
  from (
    select seq, entity, op, payload
    from public.change_log
    where shop_id = p_shop_id
      and seq > p_since
    order by seq
    limit v_limit
  ) c;

  return jsonb_build_object(
    'changes', v_changes,
    'next_since', v_next,
    'has_more', v_count >= v_limit
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- AI quota
-- ---------------------------------------------------------------------------

create or replace function public.consume_ai_quota(
  p_shop_id text,
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shop_members
    where shop_id = p_shop_id and user_id = v_user
  ) then
    raise exception 'not a shop member' using errcode = '42501';
  end if;

  insert into public.ai_usage (shop_id, user_id, day, count)
  values (p_shop_id, v_user, current_date, 1)
  on conflict (shop_id, user_id, day) do update
    set count = ai_usage.count + 1
    where ai_usage.count < p_limit
  returning count into v_count;

  if v_count is null then
    select count into v_count
    from public.ai_usage
    where shop_id = p_shop_id
      and user_id = v_user
      and day = current_date;

    return jsonb_build_object(
      'allowed', false,
      'used', coalesce(v_count, p_limit),
      'limit', p_limit
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_count,
    'limit', p_limit
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------

create or replace function public.prune_sync_history(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.change_log
  where created_at < now() - make_interval(days => greatest(p_days, 7));

  get diagnostics v_deleted = row_count;

  delete from public.sync_mutations
  where applied_at < now() - make_interval(days => greatest(p_days, 7));

  return v_deleted;
end;
$$;

revoke all on function public.prune_sync_history(integer) from public;
grant execute on function public.prune_sync_history(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists trg_product_types_sync_fields on public.product_types;
create trigger trg_product_types_sync_fields
  before insert or update on public.product_types
  for each row execute function public.set_sync_fields();

drop trigger if exists trg_product_types_change on public.product_types;
create trigger trg_product_types_change
  after insert or update or delete on public.product_types
  for each row execute function public.log_change();

drop trigger if exists trg_products_sync_fields on public.products;
create trigger trg_products_sync_fields
  before insert or update on public.products
  for each row execute function public.set_sync_fields();

drop trigger if exists trg_products_change on public.products;
create trigger trg_products_change
  after insert or update or delete on public.products
  for each row execute function public.log_change();

-- ---------------------------------------------------------------------------
-- API privileges
--
-- Supabase normally grants public-schema tables to authenticated by default,
-- but make it explicit so the migration also works on a fresh/self-hosted
-- project with different default privileges. RLS still decides row access.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.shops,
  public.shop_members,
  public.product_types,
  public.products,
  public.inventory,
  public.customers,
  public.orders,
  public.order_items,
  public.stock_movements,
  public.change_log,
  public.sync_mutations,
  public.ai_usage
to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.product_types enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.change_log enable row level security;
alter table public.sync_mutations enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops
  for select to authenticated
  using (public.is_shop_member(id));

drop policy if exists shop_members_select on public.shop_members;
create policy shop_members_select on public.shop_members
  for select to authenticated
  using (public.is_shop_member(shop_id));

drop policy if exists product_types_all on public.product_types;
create policy product_types_all on public.product_types
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists products_all on public.products;
create policy products_all on public.products
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists inventory_all on public.inventory;
create policy inventory_all on public.inventory
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists customers_all on public.customers;
create policy customers_all on public.customers
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists orders_all on public.orders;
create policy orders_all on public.orders
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists order_items_all on public.order_items;
create policy order_items_all on public.order_items
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists stock_movements_all on public.stock_movements;
create policy stock_movements_all on public.stock_movements
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

drop policy if exists change_log_select on public.change_log;
create policy change_log_select on public.change_log
  for select to authenticated
  using (public.is_shop_member(shop_id));

drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage
  for select to authenticated
  using (public.is_shop_member(shop_id));

-- sync_mutations is written only by security-definer RPCs. No client policy.

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_shop(text) from public;
revoke all on function public.join_shop(text) from public;
revoke all on function public.sync_push(text, text, jsonb) from public;
revoke all on function public.sync_pull(text, bigint, integer) from public;
revoke all on function public.consume_ai_quota(text, integer) from public;

grant execute on function public.create_shop(text) to authenticated;
grant execute on function public.join_shop(text) to authenticated;
grant execute on function public.sync_push(text, text, jsonb) to authenticated;
grant execute on function public.sync_pull(text, bigint, integer) to authenticated;
grant execute on function public.consume_ai_quota(text, integer) to authenticated;
