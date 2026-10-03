import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, ExternalLink, ShoppingBag, Trash2 } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, Field, KeyValue, PageHeader, Select } from "@/components/brand";
import { Chip, Modal, OrderSummary, QtyStepper, processingFeeMinor } from "@/components/fan/kit";
import { artistById, artists, merch as mockMerch, type MerchItem } from "@/lib/mock";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FanZuP MerchBag.tsx (store part).
 * Doc-driven: "Genesis Merch Bag", "First Flight" starter kit and "FanZuP Protocol" authentication copy dropped.
 * Items with native=false link out to the artist's own store (no FanZuP checkout — products/fees.html).
 * Campaign perks live in Backed & perks, not here.
 */

interface Item extends MerchItem {
  description: string;
  sizes?: string[];
}

const DESCRIPTIONS: Record<string, Omit<Item, keyof MerchItem>> = {
  m1: { description: "Heavyweight cotton tee with the horn-section line art on the back. Printed in Atlanta.", sizes: ["S", "M", "L", "XL", "2XL"] },
  m2: { description: "First pressing of the debut LP on 180g black vinyl, with a printed lyric insert." },
  m3: { description: "Garment-dyed hoodie from the Night Shift era. Sold and shipped by Velvet Circuit's own shop.", sizes: ["S", "M", "L", "XL"] },
  m4: { description: "18×24 risograph poster of the Third Ward skyline, signed and numbered." },
  m5: { description: "Natural canvas tote with the Ozark Soul sunburst. Fits a stack of records." },
};

const EXTRA: Item[] = [
  { id: "m6", artistId: "nova-reyes", title: "Late Night EP — Cassette", priceMinor: 1400, kind: "Vinyl", native: true, description: "Limited cassette run of the Late Night EP with a download card." },
  { id: "m7", artistId: "kai-marlo", title: "Crate Digger Cap", priceMinor: 2800, kind: "Accessory", native: false, description: "Embroidered six-panel cap. Sold on Kai Marlo's own store." },
  { id: "m8", artistId: "sol-amara", title: "Harmattan Tee", priceMinor: 3200, kind: "Apparel", native: true, description: "Soft-wash tee with hand-drawn Harmattan lettering.", sizes: ["S", "M", "L", "XL"] },
];

const ITEMS: Item[] = [...mockMerch.map((m) => ({ ...m, ...DESCRIPTIONS[m.id] })), ...EXTRA];
const KINDS = ["Apparel", "Vinyl", "Print", "Accessory"] as const;

interface CartLine {
  key: string;
  item: Item;
  size?: string;
  qty: number;
}

export default function Merch() {
  const [artist, setArtist] = useState("all");
  const [kind, setKind] = useState<(typeof KINDS)[number] | "all">("all");
  const [open, setOpen] = useState<Item | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [placed, setPlaced] = useState(false);

  const list = ITEMS.filter((i) => (artist === "all" || i.artistId === artist) && (kind === "all" || i.kind === kind));
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const subtotal = cart.reduce((s, l) => s + l.qty * l.item.priceMinor, 0);

  const add = (item: Item, qty: number, size?: string) => {
    const key = `${item.id}-${size ?? ""}`;
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(10, l.qty + qty) } : l)) : [...c, { key, item, size, qty }]));
    setPlaced(false);
  };
  const remove = (key: string) => setCart((c) => c.filter((l) => l.key !== key));
  const checkout = () => {
    setPlaced(true);
    setCart([]);
  };

  const cartPanel = (
    <CartPanel lines={cart} subtotal={subtotal} placed={placed} onRemove={remove} onCheckout={checkout} />
  );

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Merch"
        title="Merch from the artists you follow"
        description="Every purchase goes straight to the artist's store. Campaign perks you've earned live in Backed & perks."
        actions={
          <Button variant="secondary" className="lg:hidden" onClick={() => setCartOpen(true)}>
            <ShoppingBag /> Cart <span className="num">{count}</span>
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Filter by kind">
          <Chip active={kind === "all"} onClick={() => setKind("all")}>
            All
          </Chip>
          {KINDS.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {k}
            </Chip>
          ))}
        </div>
        <Field label="Artist" htmlFor="merch-artist" className="md:w-60 [&>label]:sr-only">
          <Select id="merch-artist" value={artist} onChange={(e) => setArtist(e.target.value)}>
            <option value="all">All artists</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {list.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag />}
            title="Nothing here yet"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setArtist("all");
                  setKind("all");
                }}
              >
                Show all merch
              </Button>
            }
          >
            This artist hasn't listed anything in that category. Check back after their next drop.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-3">
            {list.map((i) => (
              <li key={i.id}>
                <ProductCard item={i} onOpen={() => setOpen(i)} />
              </li>
            ))}
          </ul>
        )}
        <aside className="hidden lg:block">
          <div className="sticky top-24">{cartPanel}</div>
        </aside>
      </div>

      <ProductDialog item={open} onClose={() => setOpen(null)} onAdd={add} />
      <Modal open={cartOpen} onOpenChange={setCartOpen} title="Your cart">
        {cartPanel}
      </Modal>
    </Container>
  );
}

function ProductCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const a = artistById(item.artistId);
  return (
    <Card padded={false} interactive className="h-full overflow-hidden">
      <button type="button" onClick={onOpen} className="flex h-full w-full flex-col text-left focus:outline-none">
        <div className="relative">
          <ArtistArt seed={`merch-${item.id}`} label={item.title} className="aspect-square w-full rounded-none" />
          {!item.native && (
            <span className="absolute left-3 top-3">
              <Badge tone="neutral" icon={<ExternalLink />}>
                Artist's store
              </Badge>
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          <span className="truncate text-xs text-muted">{a.name}</span>
          <span className="text-sm font-semibold leading-snug">{item.title}</span>
          <span className="num mt-auto pt-2 text-base">{formatMoney(item.priceMinor)}</span>
        </div>
      </button>
    </Card>
  );
}

function ProductDialog({ item, onClose, onAdd }: { item: Item | null; onClose: () => void; onAdd: (i: Item, qty: number, size?: string) => void }) {
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reset = () => window.setTimeout(() => (setQty(1), setSize(""), setErr(null)), 200);
  const a = useMemo(() => (item ? artistById(item.artistId) : null), [item]);
  if (!item || !a) return <Modal open={false} onOpenChange={() => undefined} title="" />;

  const addToCart = () => {
    if (item.sizes && !size) return setErr("Pick a size.");
    onAdd(item, qty, size || undefined);
    onClose();
    reset();
  };

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          reset();
        }
      }}
      title={item.title}
      description={a.name}
      footer={
        item.native ? (
          <Button onClick={addToCart}>
            Add to cart · <span className="num">{formatMoney(item.priceMinor * qty)}</span>
          </Button>
        ) : (
          <Button asChild>
            <a href="#artist-store" rel="noopener noreferrer">
              Buy on {a.name}'s store <ExternalLink />
            </a>
          </Button>
        )
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <ArtistArt seed={`merch-${item.id}`} label={item.title} className="aspect-square w-full" />
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <Badge>{item.kind}</Badge>
            {!item.native && <Badge icon={<ExternalLink />}>Sold on artist's store</Badge>}
          </div>
          <p className="num text-2xl font-medium">{formatMoney(item.priceMinor)}</p>
          <p className="text-sm text-muted">{item.description}</p>
          {item.native ? (
            <>
              {item.sizes && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Size</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
                    {item.sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={size === s}
                        onClick={() => (setSize(s), setErr(null))}
                        className={cn("num h-11 min-w-11 rounded-md border px-3 text-sm", size === s ? "border-gold bg-gold/10 text-fg" : "border-line text-muted hover:text-fg")}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {err && <p className="text-sm text-error">{err}</p>}
                </fieldset>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Quantity</span>
                <QtyStepper value={qty} onChange={setQty} max={10} />
              </div>
            </>
          ) : (
            <p className="rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
              {a.name} sells this through their own store. You'll check out there, and FanZuP takes no cut.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CartPanel({ lines, subtotal, placed, onRemove, onCheckout }: { lines: CartLine[]; subtotal: number; placed: boolean; onRemove: (k: string) => void; onCheckout: () => void }) {
  if (placed)
    return (
      <Card className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="size-10 text-success" />
        <h2 className="text-lg font-semibold">Order placed</h2>
        <p className="text-sm text-muted">
          Order <span className="num text-fg">FZP-MER-30982</span> is confirmed. You'll get shipping updates by email.
        </p>
      </Card>
    );
  if (lines.length === 0)
    return (
      <Card className="flex flex-col items-center gap-2 py-10 text-center">
        <ShoppingBag className="size-8 text-muted" />
        <h2 className="text-base font-semibold">Your cart is empty</h2>
        <p className="text-sm text-muted">Pick something from an artist you love.</p>
      </Card>
    );
  const shipping = 600;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Cart</h2>
      <ul className="flex flex-col divide-y divide-line">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-3 py-3">
            <ArtistArt seed={`merch-${l.item.id}`} label={l.item.title} className="size-12 shrink-0" rounded="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.item.title}</p>
              <p className="text-xs text-muted">
                {l.size && <>Size {l.size} · </>}Qty <span className="num">{l.qty}</span>
              </p>
            </div>
            <span className="num text-sm">{formatMoney(l.qty * l.item.priceMinor)}</span>
            <Button variant="ghost" size="icon" aria-label={`Remove ${l.item.title}`} onClick={() => onRemove(l.key)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <OrderSummary subtotalMinor={subtotal} extraMinor={shipping} extra={<KeyValue k="Shipping (flat, US)" v={<span className="num">{formatMoney(shipping, { cents: true })}</span>} />} />
      <Button block onClick={onCheckout}>
        Check out · <span className="num">{formatMoney(subtotal + processingFeeMinor(subtotal + shipping) + shipping, { cents: true })}</span>
      </Button>
      <p className="text-center text-xs text-muted">
        Paying with Visa ending <span className="num">4242</span>. <Link to="/settings/payments" className="text-gold hover:underline">Change</Link>
      </p>
    </Card>
  );
}
