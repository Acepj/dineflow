export type RestaurantTable = {
  id: string;
  table_number: number;
  capacity: number;
  location: "indoor" | "outdoor" | "bar" | "private";
  status: "available" | "occupied" | "reserved" | "out_of_service";
};

/**
 * A staff/admin override of a single table's status *for one specific day*
 * (migration 20261015000000_table_daily_status). Lets staff plan a future day
 * independently of the table's live floor status and of its reservations.
 *
 * The status values are the "day" states staff can set: `available`,
 * `occupied`, `reserved`, `served` (food served / winding down) and
 * `out_of_service` (table out of service for this day only). A permanent
 * out-of-service flag on `restaurant_tables` still takes precedence over any
 * daily value.
 */
export type TableDailyStatusValue =
  | "available"
  | "occupied"
  | "reserved"
  | "served"
  | "out_of_service";

/**
 * A table's status for a particular day, after resolving the live status, any
 * staff daily override and the day's reservations. This is what both the
 * customer wizard and the staff floor map display, so a chosen date always
 * shows that day's real availability.
 */
export type ResolvedTableDayStatus =
  | "available"
  | "occupied"
  | "reserved"
  | "served"
  | "out_of_service";

export type TableDailyStatus = {
  id: string;
  table_id: string;
  /** Calendar day the override applies to (yyyy-mm-dd). */
  day: string;
  status: TableDailyStatusValue;
  note: string | null;
  /** Staff/admin who set this override; null if the account was removed. */
  set_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Reservation lifecycle.
 *
 * `pending`     intake state for a public booking, awaiting a staff decision.
 * `confirmed`   the booking is accepted — shown to staff as "Reserved" and the
 *               state it sits in until the guest physically arrives.
 * `arrived`     staff confirmed the guest is at the door.
 * `seated`      guest is at an occupied table.
 * `done_eating` guest finished; the table is released back to `available`.
 * `completed`   finalized; the reservation lives in Order History.
 * `cancelled` / `no_show` are terminal and release the table.
 */
export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "arrived"
  | "seated"
  | "done_eating"
  | "completed"
  | "cancelled"
  | "no_show";

/**
 * How a reservation is settled. Picked by the customer in the booking
 * wizard's "Your details" step (migration 20261014000000_reservation_payment).
 * `cash` is paid at the restaurant on arrival; `online` (GCash / card) is
 * paid immediately while booking.
 */
export type ReservationPaymentMethod = "cash" | "online";

/** Whether the reservation has been settled: `paid` for online bookings, `unpaid` for cash on arrival. */
export type ReservationPaymentStatus = "unpaid" | "paid";

export type Reservation = {
  id: string;
  code: string;
  table_id: string | null;
  guest_name: string;
  phone: string;
  email: string | null;
  party_size: number;
  reserved_from: string;
  reserved_to: string;
  status: ReservationStatus;
  special_request: string | null;
  created_at: string;
  /**
   * Optional: only present once migration
   * 20260921000000_reservation_updated_at has been applied. Readers should
   * treat a missing value as "not tracked" and fall back to `created_at`.
   */
  updated_at?: string | null;

  /* Lifecycle timestamps and the staff/admin who performed each step. All are
     optional because they only exist once migration
     20261011000000_reservation_lifecycle has been applied, and each column is
     naturally null until its stage is reached. */

  /** Guest arrival confirmed at the door. */
  arrived_at?: string | null;
  arrived_by?: string | null;
  /** Guest seated at their table. */
  seated_at?: string | null;
  seated_by?: string | null;
  /** Guest finished eating; the table was released at this point. */
  done_eating_at?: string | null;
  done_eating_by?: string | null;
  /** Finalized and moved to Order History. */
  completed_at?: string | null;
  completed_by?: string | null;

  /* How the customer chose to settle the reservation (cash on arrival or
     online at booking time). Optional because the columns only exist once
     migration 20261014000000_reservation_payment has been applied, and the
     method is only recorded for bookings made through the wizard's
     "Your details" step — older rows keep nulls. */
  payment_method?: ReservationPaymentMethod | null;
  payment_status?: ReservationPaymentStatus | null;
  /** Online settlement reference; null for cash bookings. */
  payment_reference?: string | null;
};

/**
 * One row of the audit trail (migration 20261011000000_reservation_lifecycle).
 * Records who changed what, when. `previous_status` is null for the first event.
 */
export type ReservationStatusEvent = {
  id: string;
  reservation_id: string;
  previous_status: ReservationStatus | null;
  new_status: ReservationStatus;
  action: ReservationLifecycleAction;
  performed_by: string | null;
  created_at: string;
};

/** Audit-trail action names written by the lifecycle endpoints. */
export type ReservationLifecycleAction =
  | "confirm_arrival"
  | "seat_guest"
  | "mark_done_eating"
  | "complete_reservation"
  | "assign_table"
  | "close_reservation";

export type ReservationWithTable = Reservation & {
  restaurant_tables: Pick<
    RestaurantTable,
    "table_number" | "capacity" | "location"
  > | null;
};

export type Category = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
};

export type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  prep_time: number;
  available: boolean;
  created_at: string;
};

export type MenuItemWithCategory = MenuItem & {
  categories: Pick<Category, "name"> | null;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderStatus =
  | "queued"
  | "preparing"
  | "serving"
  | "served"
  | "cancelled";
export type OrderType = "dine_in" | "takeout";
export type PaymentMethod = "cash" | "card" | "gcash" | "bank_transfer";

export type Order = {
  id: string;
  order_number: number;
  type: OrderType;
  table_id: string | null;
  reservation_id: string | null;
  customer_id: string | null;
  status: OrderStatus;
  subtotal: number;
  service_charge: number;
  tax: number;
  discount: number;
  total: number;
  created_at: string;
  updated_at: string;
  /** Order-level notes / special instructions (cart checkout migration). */
  special_instructions?: string | null;
  promo_code?: string | null;
  /** When the customer placed the order, if the ordering system tracked it. */
  requested_at?: string | null;
  /** The signed-in customer who placed this order (may be a walk-in: null). */
  user_id?: string | null;
  /**
   * Optional: only present once migration 20261012000000_history_audit_columns
   * has been applied. Staff/admin who served and closed the order. Note this is
   * deliberately *not* `user_id`, which records the customer who placed it.
   */
  processed_by?: string | null;
};

/** Payment status as shown in Order History. Derived, not a DB column. */
export type DerivedPaymentStatus = "paid" | "unpaid" | "unknown";

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string;
  menu_item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
};

export type OrderWithDetails = Order & {
  restaurant_tables: Pick<
    RestaurantTable,
    "table_number" | "capacity" | "location"
  > | null;
  customers: Pick<Customer, "name" | "phone"> | null;
  order_items: OrderItem[];
};

export type Payment = {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount_due: number;
  amount_tendered: number;
  change_amount: number;
  reference: string | null;
  created_at: string;
};

export type OrderWithPayment = OrderWithDetails & {
  payments: Payment[];
};

/**
 * Checkout / customer cart additions (migration 20260914000000_cart_checkout).
 * Optional fields so reads against databases where the migration has not yet
 * been applied remain valid.
 */
export type CartItemRow = {
  id: string;
  user_id: string;
  menu_item_id: string;
  quantity: number;
  customizations: unknown[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PromoCodeRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_subtotal: number;
  max_discount: number | null;
  expires_at: string | null;
  active: boolean;
  usage_limit: number | null;
  used_count: number;
  created_at: string;
};

export type AppliedPromo = PromoCodeRow & {
  calculated: number;
};

export type LoyaltyCustomer = Customer & {
  user_id: string | null;
  loyalty_points: number;
  member_tier: string;
};

export type CheckoutOrder = Order & {
  special_instructions: string | null;
  promo_code: string | null;
  requested_at: string | null;
};

export type MenuItemAvailability = Pick<
  MenuItem,
  "id" | "name" | "description" | "price" | "image_url" | "prep_time" | "available"
> & {
  stock: number | null;
};

/**
 * Customer "remove from history" (soft-hide) overlay — migration
 * 20260915000000_customer_history_visibility. A row here only affects the
 * authenticated customer's own history view; the underlying order/reservation
 * and its financial/payment/sales records are never modified or deleted.
 */
export type HistoryRecordType = "order" | "reservation";

export type CustomerHistoryVisibility = {
  id: string;
  user_id: string;
  record_type: HistoryRecordType;
  record_id: string;
  hidden_at: string;
  created_at: string;
};

/** A visibility row paired with the original record, used by the Archived view. */
export type ArchivedRecord<T> = T & { hidden_at: string };
