-- 库存变动审计表
CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('borrow_out', 'return_in', 'new_entry', 'maintenance', 'retire')),
  borrow_record_id UUID REFERENCES public.borrow_records(id),
  operator_id UUID NOT NULL REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_item ON public.stock_movements(item_id);
CREATE INDEX idx_stock_movements_type ON public.stock_movements(movement_type);
