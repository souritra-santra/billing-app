-- ---------------------------------------------------------------------------
-- Operational data sync: customers, bills, bill lines and append-only stock
-- movements. Catalogue sync from the first migration is unchanged.
-- ---------------------------------------------------------------------------

-- Two devices may legitimately save the same phone number for different
-- customers created offline. A non-unique lookup index avoids blocking pushes.
drop index if exists public.idx_customers_phone;
create index if not exists idx_customers_phone_lookup
  on public.customers (shop_id, phone)
  where deleted_at is null and phone is not null and phone <> '';

-- ---------------------------------------------------------------------------
-- Trigger hygiene for operational tables
-- ---------------------------------------------------------------------------

drop trigger if exists trg_customers_sync_fields on public.customers;
create trigger trg_customers_sync_fields
  before insert or update on public.customers
  for each row execute function public.set_sync_fields();

drop trigger if exists trg_customers_change on public.customers;
create trigger trg_customers_change
  after insert or update or delete on public.customers
  for each row execute function public.log_change();

drop trigger if exists trg_orders_sync_fields on public.orders;
create trigger trg_orders_sync_fields
  before insert or update on public.orders
  for each row execute function public.set_sync_fields();

drop trigger if exists trg_orders_change on public.orders;
create trigger trg_orders_change
  after insert or update or delete on public.orders
  for each row execute function public.log_change();

drop trigger if exists trg_order_items_change on public.order_items;
create trigger trg_order_items_change
  after insert or update or delete on public.order_items
  for each row execute function public.log_change();

drop trigger if exists trg_stock_movements_change on public.stock_movements;
create trigger trg_stock_movements_change
  after insert on public.stock_movements
  for each row execute function public.log_change();

-- ---------------------------------------------------------------------------
-- Delta push, now covering customers, bills, bill lines and stock movements
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
  v_customer_id text;
  v_order_id text;
  v_product_id text;
  v_size text;
  v_delta integer;
  v_reason text;
  v_deleted_at timestamptz;
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

        if not found then
          insert into public.product_types (shop_id, id, name, created_at, deleted_at)
          values (
            p_shop_id,
            v_entity_id,
            trim(coalesce(v_payload->>'name', 'Other')),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          )
          on conflict (shop_id, id) do update
            set deleted_at = excluded.deleted_at;
        end if;
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
        v_name := trim(coalesce(v_payload->>'name', 'Deleted product'));
        v_type_id := nullif(v_payload->>'type_id', '');
        if v_type_id is null or not exists (
          select 1 from public.product_types
          where shop_id = p_shop_id and id = v_type_id
        ) then
          v_type_id := 'pt-008';
          insert into public.product_types (shop_id, id, name)
          values (p_shop_id, 'pt-008', 'Other')
          on conflict (shop_id, id) do nothing;
        end if;

        insert into public.products (
          shop_id, id, name, type_id, cost_price, price, created_at,
          deleted_at, updated_by, device_id
        ) values (
          p_shop_id,
          v_entity_id,
          v_name,
          v_type_id,
          coalesce((v_payload->>'cost_price')::numeric, 0),
          coalesce((v_payload->>'price')::numeric, 0),
          coalesce((v_payload->>'created_at')::timestamptz, now()),
          now(),
          v_user,
          p_device_id
        )
        on conflict (shop_id, id) do update
          set deleted_at = now(),
              barcode = null,
              updated_by = v_user,
              device_id = p_device_id;

        update public.inventory
        set quantity = 0,
            deleted_at = now()
        where shop_id = p_shop_id and product_id = v_entity_id;
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

        -- Defensive: a product must always carry a valid type FK. Normally the
        -- type mutation is earlier in the batch, but an older device may have a
        -- product whose type was created before catalogue sync existed.
        if not exists (
          select 1 from public.product_types
          where shop_id = p_shop_id and id = v_type_id
        ) then
          insert into public.product_types (shop_id, id, name, created_at)
          values (p_shop_id, v_type_id, 'Other (' || v_type_id || ')', now())
          on conflict (shop_id, id) do nothing;
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

    elsif v_entity = 'customers' then
      v_deleted_at := case
        when v_op = 'delete' then now()
        else nullif(v_payload->>'deleted_at', '')::timestamptz
      end;

      if v_deleted_at is not null then
        update public.customers
        set deleted_at = v_deleted_at
        where shop_id = p_shop_id and id = v_entity_id;

        if not found then
          insert into public.customers (
            shop_id, id, name, phone, total_purchase, due_amount, created_at,
            deleted_at
          ) values (
            p_shop_id,
            v_entity_id,
            trim(coalesce(v_payload->>'name', 'Customer')),
            nullif(trim(coalesce(v_payload->>'phone', '')), ''),
            coalesce((v_payload->>'total_purchase')::numeric, 0),
            coalesce((v_payload->>'due_amount')::numeric, 0),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            v_deleted_at
          )
          on conflict (shop_id, id) do update
            set deleted_at = excluded.deleted_at;
        end if;
      else
        v_name := trim(coalesce(v_payload->>'name', ''));
        if v_name = '' then
          raise exception 'customer name is required' using errcode = '22023';
        end if;

        insert into public.customers (
          shop_id, id, name, phone, total_purchase, due_amount, created_at
        ) values (
          p_shop_id,
          v_entity_id,
          v_name,
          nullif(trim(coalesce(v_payload->>'phone', '')), ''),
          coalesce((v_payload->>'total_purchase')::numeric, 0),
          coalesce((v_payload->>'due_amount')::numeric, 0),
          coalesce((v_payload->>'created_at')::timestamptz, now())
        )
        on conflict (shop_id, id) do update
          set name = excluded.name,
              phone = excluded.phone,
              total_purchase = excluded.total_purchase,
              due_amount = excluded.due_amount,
              deleted_at = null;
      end if;

    elsif v_entity = 'orders' then
      v_deleted_at := case
        when v_op = 'delete' then now()
        else nullif(v_payload->>'deleted_at', '')::timestamptz
      end;

      if v_deleted_at is not null then
        update public.orders
        set deleted_at = v_deleted_at
        where shop_id = p_shop_id and id = v_entity_id;

        if not found then
          v_customer_id := nullif(v_payload->>'customer_id', '');
          if v_customer_id is not null and not exists (
            select 1 from public.customers
            where shop_id = p_shop_id and id = v_customer_id
          ) then
            insert into public.customers (shop_id, id, name, created_at)
            values (p_shop_id, v_customer_id, 'Customer', now())
            on conflict (shop_id, id) do nothing;
          end if;

          insert into public.orders (
            shop_id, id, date, customer_id, total_amount, discount, tax,
            final_amount, payment_mode, created_at, deleted_at, device_id
          ) values (
            p_shop_id,
            v_entity_id,
            coalesce((v_payload->>'date')::timestamptz, now()),
            v_customer_id,
            coalesce((v_payload->>'total_amount')::numeric, 0),
            coalesce((v_payload->>'discount')::numeric, 0),
            coalesce((v_payload->>'tax')::numeric, 0),
            coalesce((v_payload->>'final_amount')::numeric, 0),
            coalesce(nullif(v_payload->>'payment_mode', ''), 'cash'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            v_deleted_at,
            p_device_id
          )
          on conflict (shop_id, id) do update
            set deleted_at = excluded.deleted_at,
                device_id = p_device_id;
        end if;
      else
        v_customer_id := nullif(v_payload->>'customer_id', '');
        if v_customer_id is not null and not exists (
          select 1 from public.customers
          where shop_id = p_shop_id and id = v_customer_id
        ) then
          insert into public.customers (shop_id, id, name, created_at)
          values (p_shop_id, v_customer_id, 'Customer', now())
          on conflict (shop_id, id) do nothing;
        end if;

        insert into public.orders (
          shop_id, id, date, customer_id, total_amount, discount, tax,
          final_amount, payment_mode, created_at, device_id
        ) values (
          p_shop_id,
          v_entity_id,
          coalesce((v_payload->>'date')::timestamptz, now()),
          v_customer_id,
          coalesce((v_payload->>'total_amount')::numeric, 0),
          coalesce((v_payload->>'discount')::numeric, 0),
          coalesce((v_payload->>'tax')::numeric, 0),
          coalesce((v_payload->>'final_amount')::numeric, 0),
          coalesce(nullif(v_payload->>'payment_mode', ''), 'cash'),
          coalesce((v_payload->>'created_at')::timestamptz, now()),
          p_device_id
        )
        on conflict (shop_id, id) do update
          set date = excluded.date,
              customer_id = excluded.customer_id,
              total_amount = excluded.total_amount,
              discount = excluded.discount,
              tax = excluded.tax,
              final_amount = excluded.final_amount,
              payment_mode = excluded.payment_mode,
              deleted_at = null,
              device_id = p_device_id;
      end if;

    elsif v_entity = 'order_items' then
      if v_op = 'delete' then
        delete from public.order_items
        where shop_id = p_shop_id and id = v_entity_id;
      else
        v_order_id := nullif(v_payload->>'order_id', '');
        v_product_id := nullif(v_payload->>'product_id', '');
        if v_order_id is null or v_product_id is null then
          raise exception 'order item needs an order and product' using errcode = '22023';
        end if;

        if not exists (
          select 1 from public.orders
          where shop_id = p_shop_id and id = v_order_id
        ) then
          insert into public.orders (shop_id, id, date, created_at)
          values (p_shop_id, v_order_id, now(), now())
          on conflict (shop_id, id) do nothing;
        end if;

        if not exists (
          select 1 from public.products
          where shop_id = p_shop_id and id = v_product_id
        ) then
          raise exception 'order item product % not found', v_product_id
            using errcode = '23503';
        end if;

        insert into public.order_items (
          shop_id, id, order_id, product_id, size, quantity, price, created_at
        ) values (
          p_shop_id,
          v_entity_id,
          v_order_id,
          v_product_id,
          coalesce(nullif(v_payload->>'size', ''), ''),
          greatest(1, coalesce((v_payload->>'quantity')::integer, 1)),
          coalesce((v_payload->>'price')::numeric, 0),
          coalesce((v_payload->>'created_at')::timestamptz, now())
        )
        on conflict (shop_id, id) do update
          set order_id = excluded.order_id,
              product_id = excluded.product_id,
              size = excluded.size,
              quantity = excluded.quantity,
              price = excluded.price;
      end if;

    elsif v_entity = 'stock_movements' then
      v_product_id := nullif(v_payload->>'product_id', '');
      v_size := coalesce(nullif(v_payload->>'size', ''), '');
      v_delta := coalesce((v_payload->>'delta')::integer, 0);
      v_reason := coalesce(nullif(v_payload->>'reason', ''), 'adjustment');

      if v_product_id is null or v_size = '' or v_delta = 0 then
        raise exception 'invalid stock movement' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.products
        where shop_id = p_shop_id and id = v_product_id
      ) then
        raise exception 'stock movement product % not found', v_product_id
          using errcode = '23503';
      end if;

      insert into public.stock_movements (
        shop_id, id, product_id, size, delta, reason, order_id, device_id,
        created_at
      ) values (
        p_shop_id,
        v_entity_id,
        v_product_id,
        v_size,
        v_delta,
        coalesce(nullif(v_payload->>'reason', ''), 'adjustment'),
        nullif(v_payload->>'order_id', ''),
        p_device_id,
        coalesce((v_payload->>'created_at')::timestamptz, now())
      )
      on conflict (shop_id, id) do nothing;

      if found and exists (
        select 1 from public.products
        where shop_id = p_shop_id
          and id = v_product_id
          and deleted_at is null
      ) then
        insert into public.inventory (
          shop_id, id, product_id, size, quantity, created_at, updated_at
        ) values (
          p_shop_id,
          'inv-' || v_entity_id,
          v_product_id,
          v_size,
          greatest(v_delta, 0),
          now(),
          now()
        )
        on conflict (shop_id, product_id, size) where deleted_at is null
        do update
          set quantity = case
                when v_reason = 'baseline' then greatest(v_delta, 0)
                else greatest(0, inventory.quantity + v_delta)
              end,
              updated_at = now();
      end if;

    else
      raise exception 'unsupported sync entity: %', v_entity using errcode = '22023';
    end if;

    insert into public.sync_mutations (mutation_id, shop_id, user_id)
    values (v_mutation_id, p_shop_id, v_user)
    on conflict (mutation_id) do nothing;

    v_applied := array_append(v_applied, v_mutation_id);
  end loop;

  -- Customer totals are derived from the bill ledger. Another device cannot
  -- know this device's orders when it pushes its own customer row, so recompute
  -- after every push and let the resulting change_log rows converge devices.
  update public.customers c
  set total_purchase = coalesce((
        select sum(o.final_amount)
        from public.orders o
        where o.shop_id = c.shop_id
          and o.customer_id = c.id
          and o.deleted_at is null
      ), 0)
  where c.shop_id = p_shop_id
    and c.deleted_at is null
    and c.total_purchase <> coalesce((
        select sum(o.final_amount)
        from public.orders o
        where o.shop_id = c.shop_id
          and o.customer_id = c.id
          and o.deleted_at is null
      ), 0);

  return jsonb_build_object(
    'applied', to_jsonb(v_applied),
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.sync_push(text, text, jsonb) from public;
grant execute on function public.sync_push(text, text, jsonb) to authenticated;
