"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import type {
  DemoSchoolData,
  DemoStudent,
  Product,
  Receipt,
  StudentAppSearchResult
} from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { CartPanel } from "./CartPanel";
import { ProductCatalog } from "./ProductCatalog";
import { StudentSelector } from "./StudentSelector";
import { productCategory, toCents } from "./registerUtils";
import type { CartLine, PaymentMethod } from "./types";

export function RegisterClient({ initialDemo }: { initialDemo: DemoSchoolData | null }) {
  const [demo, setDemo] = useState<DemoSchoolData | null>(initialDemo);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    initialDemo?.students[0]?.id || ""
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialDemo);
  const [selling, setSelling] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentSearchResults, setStudentSearchResults] = useState<StudentAppSearchResult[]>([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  async function loadDemo() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<DemoSchoolData>("/demo/school", {});
      setDemo({ ...data, students: [] });
      setSelectedStudentId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load demo data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialDemo) {
      void loadDemo();
    }
  }, [initialDemo]);

  const selectedStudent = useMemo(
    () => demo?.students.find((student) => student.id === selectedStudentId) || null,
    [demo, selectedStudentId]
  );

  const subtotalCents = cart.reduce(
    (sum, line) => sum + toCents(line.product.priceCents) * line.quantity,
    0
  );
  const currentBalanceCents = Number(
    receipt?.wallet?.balanceCents ?? selectedStudent?.wallet.balanceCents ?? 0
  );
  const creditLimitCents = Number(
    receipt?.wallet?.creditLimitCents ?? selectedStudent?.wallet.creditLimitCents ?? 0
  );
  const balanceAfterCartCents = currentBalanceCents - subtotalCents;
  const creditRemainingCents = Math.max(0, creditLimitCents + Math.min(0, currentBalanceCents));
  const creditExceededCents = Math.max(0, -balanceAfterCartCents - creditLimitCents);
  const walletStatus =
    creditExceededCents > 0
      ? "Blocked"
      : balanceAfterCartCents < 0
        ? "Using credit"
        : "OK";
  const selectedBalanceCents = Number(
    receipt?.wallet?.balanceCents ?? selectedStudent?.wallet.balanceCents ?? 0
  );
  const walletSaleBlocked = paymentMethod === "wallet" && (!selectedStudent || creditExceededCents > 0);
  const completeDisabled = selling || cart.length === 0 || walletSaleBlocked;
  const completeHelp =
    cart.length === 0
      ? "Add an item before completing the sale."
      : paymentMethod === "wallet" && !selectedStudent
        ? "Search and select a student before using wallet payment."
        : paymentMethod === "wallet" && creditExceededCents > 0
          ? `Credit limit exceeded by ${formatMoney(creditExceededCents)}.`
          : "";
  const categories = useMemo(() => {
    const unique = new Set((demo?.products || []).map(productCategory));
    return ["All", ...Array.from(unique)];
  }, [demo?.products]);
  const visibleProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    return (demo?.products || []).filter((product) => {
      const matchesCategory =
        selectedCategory === "All" || productCategory(product) === selectedCategory;
      const matchesSearch =
        !search ||
        product.name.toLowerCase().includes(search) ||
        (product.sku || "").toLowerCase().includes(search) ||
        (product.description || "").toLowerCase().includes(search);
      return matchesCategory && matchesSearch;
    });
  }, [demo?.products, productSearch, selectedCategory]);

  function createIdempotencyKey() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function addProduct(product: Product) {
    if (product.inventoryStatus === "out") {
      setCheckoutMessage(`${product.name} is out of stock.`);
      return;
    }

    setReceipt(null);
    setCheckoutMessage(null);
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (!existing) {
        return [...current, { product, quantity: 1 }];
      }
      return current.map((line) =>
        line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line
      );
    });
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line
        )
        .filter((line) => line.quantity > 0)
    );
  }

  async function searchStudentAppStudents() {
    if (!demo || !studentSearch.trim()) return;

    setSearchingStudents(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: studentSearch.trim()
      });

      const students = await apiGet<StudentAppSearchResult[]>(
        `/integrations/student-app/students/search?${params}`
      );
      setStudentSearchResults(students);
      if (students.length === 0) {
        setError("No matching Student Educational app student found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search Student app students");
    } finally {
      setSearchingStudents(false);
    }
  }

  async function linkStudentAppStudent(studentResult: StudentAppSearchResult) {
    if (!demo) return;

    setError(null);
    try {
      const linked = await apiPost<{
        customer: DemoStudent;
        wallet: DemoStudent["wallet"];
      }>("/integrations/student-app/students", {
        externalSchoolId: demo.organization.externalSchoolId,
        externalStudentId: studentResult.id,
        name: studentResult.name || "Spelling App Student",
        startingBalanceCents: 0,
        creditLimitCents: 2500
      });

      const linkedStudent: DemoStudent = {
        ...linked.customer,
        wallet: linked.wallet
      };

      setDemo({
        ...demo,
        students: [
          linkedStudent,
          ...demo.students.filter((existing) => existing.id !== linkedStudent.id)
        ]
      });
      setSelectedStudentId(linkedStudent.id);
      setStudentSearchResults([]);
      setStudentSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link Student app student");
    }
  }

  async function completeSale() {
    setCheckoutMessage(null);

    if (!demo) {
      setError("Register data is still loading. Try reload products.");
      return;
    }

    if (cart.length === 0) {
      setCheckoutMessage("Add an item before completing the sale.");
      return;
    }

    if (paymentMethod === "wallet" && !selectedStudent) {
      setCheckoutMessage("Search and select a student before using wallet payment.");
      return;
    }

    if (paymentMethod === "wallet" && creditExceededCents > 0) {
      setCheckoutMessage(`Credit limit exceeded by ${formatMoney(creditExceededCents)}.`);
      return;
    }

    setSelling(true);
    setError(null);
    setCheckoutMessage(`Submitting ${paymentMethod} sale...`);
    setReceipt(null);

    try {
      const saleItems = cart.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity
      }));

      const result =
        paymentMethod === "wallet"
          ? await apiPost<Receipt>(
              "/orders/wallet-sale",
              {
                organizationId: demo.organization.id,
                storeId: demo.store.id,
                customerId: selectedStudent?.id,
                walletAccountId: selectedStudent?.wallet.id,
                items: saleItems
              },
              { "Idempotency-Key": createIdempotencyKey() }
            )
          : await apiPost<Receipt>(
              "/orders/paid-sale",
              {
                organizationId: demo.organization.id,
                storeId: demo.store.id,
                customerId: selectedStudent?.id || null,
                paymentMethod,
                registerName: "Lunch Line 02",
                items: saleItems
              },
              { "Idempotency-Key": createIdempotencyKey() }
            );

      setReceipt(result);
      setCheckoutMessage(`Sale completed by ${result.payment.method}.`);
      setCart([]);

      if ((result.inventory && result.inventory.length > 0) || (paymentMethod === "wallet" && selectedStudent && result.wallet)) {
        const inventoryByProductId = new Map(
          (result.inventory || []).map((movement) => [movement.productId, movement])
        );

        setDemo({
          ...demo,
          products: demo.products.map((product) => {
            const movement = inventoryByProductId.get(product.id);
            if (!movement) return product;

            const quantityAfter = movement.quantityAfter;
            const reorderThreshold = Number(product.reorderThreshold || 0);
            return {
              ...product,
              quantityOnHand: quantityAfter,
              inventoryStatus:
                quantityAfter === 0
                  ? "out"
                  : quantityAfter <= reorderThreshold
                    ? "low"
                    : "in_stock"
            };
          }),
          students:
            paymentMethod === "wallet" && selectedStudent && result.wallet
              ? demo.students.map((student) =>
            student.id === selectedStudent.id
              ? {
                  ...student,
                  wallet: {
                    ...student.wallet,
                    balanceCents: result.wallet!.balanceCents,
                    creditLimitCents: result.wallet!.creditLimitCents
                  }
                }
              : student
          )
              : demo.students
        });
      }
    } catch (err) {
      setCheckoutMessage(err instanceof Error ? err.message : "Sale failed");
    } finally {
      setSelling(false);
    }
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Cashier workflow" title="Cafeteria Register">
        <button type="button" onClick={loadDemo} disabled={loading}>
          {loading ? "Loading..." : "Reload products"}
        </button>
      </PageHeader>

      <div className="permissionStrip">
        <div>
          <span>Signed in employee</span>
          <strong>Jordan Lee - Cashier</strong>
          <small>Allowed: sell inventory, search students, take cash/card/wallet payments.</small>
        </div>
        <div>
          <span>Admin permissions</span>
          <strong>Locked</strong>
          <small>Inventory edits, staff roles, tax settings, and register setup require manager/admin.</small>
        </div>
        <div>
          <span>Register</span>
          <strong>Lunch Line 02</strong>
          <small>Cafeteria mode for school meal service.</small>
        </div>
      </div>

      {error ? (
        <p className="demoError" role="alert">
          {error}
        </p>
      ) : null}

      <div className="registerGrid">
        <ProductCatalog
          products={visibleProducts}
          productSearch={productSearch}
          selectedCategory={selectedCategory}
          categories={categories}
          onSearchChange={setProductSearch}
          onCategoryChange={setSelectedCategory}
          onProductSelect={addProduct}
        />

        <aside className="cartPane">
          <StudentSelector
            students={demo?.students || []}
            selectedStudentId={selectedStudentId}
            studentSearch={studentSearch}
            searchResults={studentSearchResults}
            searchingStudents={searchingStudents}
            onSearchChange={setStudentSearch}
            onSearchSubmit={() => {
              void searchStudentAppStudents();
            }}
            onStudentResultSelect={(student) => {
              void linkStudentAppStudent(student);
            }}
            onStudentSelect={(studentId) => {
              setSelectedStudentId(studentId);
              setReceipt(null);
            }}
          />

          <CartPanel
            cart={cart}
            receipt={receipt}
            selectedStudent={selectedStudent}
            selectedBalanceCents={selectedBalanceCents}
            walletStatus={walletStatus}
            creditExceededCents={creditExceededCents}
            subtotalCents={subtotalCents}
            paymentMethod={paymentMethod}
            selling={selling}
            completeDisabled={completeDisabled}
            checkoutMessage={checkoutMessage}
            completeHelp={completeHelp}
            onQuantityChange={updateQuantity}
            onPaymentMethodChange={setPaymentMethod}
            onCompleteSale={() => {
              void completeSale();
            }}
          />
        </aside>
      </div>
    </section>
  );
}
