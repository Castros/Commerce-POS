export type OrgFeatures = {
  ai?: boolean;
  guardians?: boolean;
  fee_assignments?: boolean;
  student_integration?: boolean;
  payroll?: boolean;
};

export type Organization = {
  id: string;
  name: string;
  type: string;
  externalSchoolId: string | null;
  active?: boolean;
  currency?: string;
  taxEnabled?: boolean;
  taxRateBps?: number;
  contactEmail?: string | null;
  features?: OrgFeatures;
  createdAt?: string;
};

export type Store = {
  id: string;
  organizationId: string;
  name: string;
  type: string;
};

export type Product = {
  id: string;
  organizationId: string;
  storeId: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl?: string | null;
  priceCents: number | string;
  costCents?: number | string | null;
  currency: string;
  taxable: boolean;
  active: boolean;
  quantityOnHand?: number | string;
  reorderThreshold?: number | string;
  location?: string | null;
  inventoryStatus?: "in_stock" | "low" | "out" | "not_tracked";
};

export type Category = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  color: string | null;
  isSystem: boolean;
  active: boolean;
  createdAt: string;
};

export type FeeAssignment = {
  id: string;
  organizationId: string;
  storeId: string;
  customerId: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  currency: string;
  description: string;
  dueDate: string | null;
  status: "pending" | "paid" | "cancelled";
  paidOrderId: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Wallet = {
  id: string;
  organizationId: string;
  customerId: string;
  balanceCents: number | string;
  creditLimitCents?: number | string;
  currency: string;
  active: boolean;
};

export type DemoStudent = {
  id: string;
  organizationId: string;
  externalStudentId: string | null;
  externalParentId: string | null;
  externalId: string | null;
  familyCode: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName1: string | null;
  lastName2: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  avatarPublicId?: string | null;
  wallet: Wallet;
};

export type DemoSchoolData = {
  organization: Organization;
  store: Store;
  products: Product[];
  students: DemoStudent[];
};

export type StudentAppSearchResult = {
  id: string;
  firstName: string;
  lastName: string | null;
  name: string;
  externalId: string | null;
  preferredGrade: string | null;
  schoolEmail: string | null;
  schoolId: string | null;
  classroom: {
    name: string;
    grade: string | null;
  } | null;
};

export type Receipt = {
  order: {
    id: string;
    organizationId: string;
    storeId: string;
    customerId: string;
    status: string;
    paymentStatus: string;
    subtotalCents: number;
    taxCents: number;
    discountCents: number;
    totalCents: number;
    currency: string;
    createdAt: string;
  };
  items: Array<{
    id: string;
    productId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
    currency: string;
  }>;
  payment: {
    id: string;
    method: string;
    status: string;
    amountCents: number;
    currency: string;
  };
  inventory?: Array<{
    productId: string;
    quantityDelta: number;
    quantityAfter: number;
  }>;
  cashDrawer?: {
    id: string;
    registerName: string;
    expectedCashCents: number;
  } | null;
  wallet?: {
    id: string;
    balanceCents: number;
    creditLimitCents?: number;
    currency: string;
  };
};

export type CashDrawerSession = {
  id: string;
  organizationId: string;
  storeId: string;
  registerName: string;
  status: "open" | "closed";
  openingCashCents: number;
  expectedCashCents: number;
  countedCashCents: number | null;
  overShortCents: number | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
};

export type InventoryItem = {
  productId: string;
  organizationId: string;
  storeId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  priceCents: number | string;
  currency: string;
  taxable: boolean;
  quantityOnHand: number | string;
  reorderThreshold: number | string;
  location: string | null;
  trackInventory: boolean;
  status: "in_stock" | "low" | "out" | "not_tracked";
  updatedAt: string | null;
};

export type OrderSummary = {
  id: string;
  organizationId: string;
  storeId: string;
  storeName: string;
  customerId: string | null;
  customerName: string | null;
  status: string;
  paymentStatus: string;
  totalCents: number | string;
  currency: string;
  paymentMethod: string | null;
  createdAt: string;
};

export type OrderDetail = {
  order: OrderSummary & {
    subtotalCents: number | string;
    taxCents: number | string;
    discountCents: number | string;
    paymentId: string | null;
    paymentStatusDetail: string | null;
  };
  items: Array<{
    id: string;
    productId: string;
    name: string;
    unitPriceCents: number | string;
    quantity: number;
    refundedQuantity: number;
    lineTotalCents: number | string;
    currency: string;
    createdAt: string;
  }>;
  wallet: {
    walletAccountId: string;
    balanceAfterCents: number | string;
    amountCents: number | string;
    createdAt: string;
  } | null;
  inventory: Array<{
    productId: string;
    productName: string;
    quantityDelta: number;
    quantityAfter: number;
    createdAt: string;
  }>;
};

export type RefundReceipt = {
  order: {
    id: string;
    organizationId: string;
    storeId: string;
    customerId: string | null;
    status: string;
    paymentStatus: string;
    totalCents: number;
    currency: string;
  };
  payment: {
    id: string;
    method: string;
    status: string;
    amountCents: number;
    currency: string;
  };
  wallet: {
    id: string;
    balanceCents: number;
    creditLimitCents?: number;
    currency: string;
  } | null;
  cashDrawer: {
    id: string;
    registerName: string;
    expectedCashCents: number;
  } | null;
  inventory: Array<{
    productId: string;
    quantityDelta: number;
    quantityAfter: number;
  }>;
};

export type Supplier = {
  id: string;
  organizationId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  vendorNumber: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
};

export type InventoryInvoice = {
  id: string;
  organizationId: string;
  storeId: string;
  storeName: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  receivedDate: string | null;
  subtotalCents: number | string;
  taxCents: number | string;
  totalCents: number | string;
  status: string;
  source: string;
  attachmentUrl: string | null;
  notes: string | null;
  approvedAt: string | null;
  createdAt: string;
  lineCount: number;
};

export type InventoryImportBatch = {
  id: string;
  organizationId: string;
  storeId: string | null;
  storeName: string | null;
  filename: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  createdAt: string;
  approvedAt: string | null;
  appliedAt: string | null;
};

export type ReceiptExtractionDraft = {
  id: string;
  organizationId: string;
  storeId: string | null;
  storeName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: string;
  imageUrl: string | null;
  confidence: number | string | null;
  extractedPayload: Record<string, unknown>;
  reviewNotes: string | null;
  createdInvoiceId: string | null;
  createdAt: string;
  approvedAt: string | null;
};

export type InventoryTransfer = {
  id: string;
  organizationId: string;
  productId: string;
  productName: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  quantity: number;
  status: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
};
