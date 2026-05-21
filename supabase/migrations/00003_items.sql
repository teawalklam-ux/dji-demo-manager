-- 样机库存表
CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,
  category_id UUID NOT NULL REFERENCES public.categories(id),
  status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock', 'borrowed', 'overdue', 'maintenance', 'retired')),
  specs JSONB DEFAULT '{}',
  purchase_date DATE,
  purchase_price DECIMAL(10,2),
  notes TEXT,
  image_url TEXT,
  location TEXT,
  current_borrower_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_status ON public.items(status);
CREATE INDEX idx_items_category ON public.items(category_id);
CREATE INDEX idx_items_barcode ON public.items(barcode);
