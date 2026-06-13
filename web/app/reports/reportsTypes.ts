export type ReportSummary = {
  filters: {
    organizationId: string;
    storeId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  };
  totals: {
    paidOrderCount: number;
    refundedOrderCount: number;
    grossSalesCents: number;
    refundedSalesCents: number;
    netSalesCents: number;
    walletSalesCents: number;
    cashSalesCents: number;
    cardSalesCents: number;
    averageOrderCents: number;
  };
  wallet: {
    walletSpendCents: number;
    walletTopUpsCents: number;
    walletRefundsCents: number;
    walletStudentCount: number;
  };
  productSales: Array<{
    productId: string;
    productName: string;
    unitsSold: number;
    revenueCents: number;
    cogsCents: number | null;
    grossProfitCents: number | null;
    marginPct: number | null;
  }>;
  storeSales: Array<{
    storeId: string;
    storeName: string;
    orderCount: number;
    salesCents: number;
  }>;
  paymentMethods: Array<{
    method: string;
    orderCount: number;
    amountCents: number;
  }>;
  cashDrawers: Array<{
    id: string;
    storeName: string;
    registerName: string;
    status: string;
    openingCashCents: number;
    expectedCashCents: number;
    countedCashCents: number | null;
    overShortCents: number;
    openedAt: string;
    closedAt: string | null;
  }>;
};

