"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { loadRegisterContext } from "../lib/organizationContext";
import { CartPanel } from "./CartPanel";
import { ProductCatalog } from "./ProductCatalog";
import { StudentSelector } from "./StudentSelector";
import { productCategory, toCents } from "./registerUtils";
import type { CartLine, PaymentMethod, RegisterSearchResult } from "./types";

type StudentCredentialResolveResponse = {
  credential: {
    id: string;
    credentialType: string;
    credentialLabel: string | null;
    active: boolean;
  };
  customer: Omit<DemoStudent, "wallet">;
  wallet: DemoStudent["wallet"];
};

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<BufferSource> | null;
};

type NavigatorWithSerial = Navigator & {
  serial?: {
    getPorts(): Promise<SerialPortLike[]>;
    requestPort(): Promise<SerialPortLike>;
  };
};

const NFC_READER_AUTO_CONNECT_KEY = "commerce_pos_nfc_reader_auto_connect";

function credentialFromSerialLine(line: string) {
  const normalized = line.trim();
  if (!normalized) return null;

  const [label, ...rest] = normalized.split(":");
  const value = rest.join(":").trim();
  const upperLabel = label.trim().toUpperCase();

  if ((upperLabel === "TOKEN" || upperLabel === "CRED" || upperLabel === "CREDENTIAL") && value) {
    return value;
  }

  if (upperLabel === "UID" && value) {
    return value.replace(/\s+/g, "").toUpperCase();
  }

  if (normalized.startsWith("cred_")) {
    return normalized;
  }

  return null;
}

export function RegisterClient({ initialDemo }: { initialDemo: DemoSchoolData | null }) {
  const demoRef = useRef<DemoSchoolData | null>(initialDemo);
  const serialPortRef = useRef<SerialPortLike | null>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<BufferSource> | null>(null);
  const serialStopRequestedRef = useRef(false);
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
  const [studentSearchResults, setStudentSearchResults] = useState<RegisterSearchResult[]>([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [resolvingCredential, setResolvingCredential] = useState(false);
  const [serialSupported, setSerialSupported] = useState(false);
  const [serialConnecting, setSerialConnecting] = useState(false);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialMessage, setSerialMessage] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  async function loadRegisterData() {
    setLoading(true);
    setError(null);
    try {
      const context = await loadRegisterContext();
      const data: DemoSchoolData = { ...context, students: [] };
      setDemo({ ...data, students: [] });
      setSelectedStudentId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load register data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialDemo) {
      void loadRegisterData();
    }
  }, [initialDemo]);

  useEffect(() => {
    demoRef.current = demo;
  }, [demo]);

  useEffect(() => {
    setSerialSupported(
      typeof navigator !== "undefined" && Boolean((navigator as NavigatorWithSerial).serial)
    );

    return () => {
      serialStopRequestedRef.current = true;
      void serialReaderRef.current?.cancel().catch(() => undefined);
      void serialPortRef.current?.close().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!serialSupported) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(NFC_READER_AUTO_CONNECT_KEY) !== "true") return;

    const timeout = window.setTimeout(() => {
      void connectNfcReader(true);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [serialSupported]);

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

  async function searchStudents(query = studentSearch) {
    const currentDemo = demoRef.current;
    const trimmed = query.trim();
    if (!currentDemo || !trimmed) return;

    setSearchingStudents(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: trimmed
      });

      const [studentAppStudents, customers, wallets] = await Promise.all([
        apiGet<StudentAppSearchResult[]>(`/integrations/student-app/students/search?${params}`),
        apiGet<Omit<DemoStudent, "wallet">[]>(`/customers?organizationId=${currentDemo.organization.id}`),
        apiGet<DemoStudent["wallet"][]>(`/wallets?organizationId=${currentDemo.organization.id}`)
      ]);

      const lower = trimmed.toLowerCase();
      const posResults: RegisterSearchResult[] = customers
        .filter((customer) =>
          [customer.name || "", customer.externalId || "", customer.email || "", customer.phone || ""]
            .some((value) => value.toLowerCase().includes(lower))
        )
        .map((customer) => ({
          source: "pos",
          id: customer.id,
          name: customer.name || "Unnamed student",
          externalId: customer.externalId,
          email: customer.email,
          classroomLabel: customer.email || "POS customer",
          customer,
          wallet: wallets.find((wallet) => wallet.customerId === customer.id) || null
        }));

      const studentAppResults: RegisterSearchResult[] = studentAppStudents.map((student) => ({
        source: "student_app",
        id: student.id,
        name: student.name,
        externalId: student.externalId,
        email: student.schoolEmail,
        classroomLabel: student.classroom?.name || student.preferredGrade || "Student app",
        student
      }));

      const merged = [...posResults, ...studentAppResults];
      setStudentSearchResults(merged);
      if (merged.length === 0) {
        setError("No matching student found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search students");
    } finally {
      setSearchingStudents(false);
    }
  }

  useEffect(() => {
    const query = studentSearch.trim();
    if (query.length < 3) {
      setStudentSearchResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchStudents(query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [studentSearch]);

  function selectPosStudent(result: Extract<RegisterSearchResult, { source: "pos" }>) {
    if (!demo || !result.wallet) {
      setError("This student does not have a wallet yet. Create a wallet from Customers first.");
      return;
    }

    const linkedStudent: DemoStudent = {
      ...result.customer,
      wallet: result.wallet
    };
    setDemo({
      ...demo,
      students: [linkedStudent]
    });
    setSelectedStudentId(linkedStudent.id);
    setStudentSearchResults([]);
    setStudentSearch("");
    setReceipt(null);
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
        students: [linkedStudent]
      });
      setSelectedStudentId(linkedStudent.id);
      setStudentSearchResults([]);
      setStudentSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link Student app student");
    }
  }

  async function selectSearchResult(result: RegisterSearchResult) {
    if (result.source === "pos") {
      selectPosStudent(result);
      return;
    }

    await linkStudentAppStudent(result.student);
  }

  async function resolveCredential(credentialToken: string) {
    const currentDemo = demoRef.current;
    if (!currentDemo || resolvingCredential) return;

    setResolvingCredential(true);
    setError(null);
    setSerialMessage("Reading NFC credential...");
    try {
      const result = await apiPost<StudentCredentialResolveResponse>("/student-credentials/resolve", {
        organizationId: currentDemo.organization.id,
        credentialToken
      });

      const linkedStudent: DemoStudent = {
        ...result.customer,
        wallet: result.wallet
      };

      setDemo({
        ...currentDemo,
        students: [linkedStudent]
      });
      setSelectedStudentId(linkedStudent.id);
      setStudentSearch("");
      setStudentSearchResults([]);
      setReceipt(null);
      setSerialMessage(`Selected ${linkedStudent.name || "student"} from NFC.`);
    } catch (err) {
      setSerialMessage(err instanceof Error ? err.message : "Could not resolve NFC credential");
    } finally {
      setResolvingCredential(false);
    }
  }

  async function readSerialPort(port: SerialPortLike) {
    if (!port.readable) {
      throw new Error("NFC reader is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const reader = port.readable.getReader();
    serialReaderRef.current = reader;

    try {
      while (!serialStopRequestedRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const credentialToken = credentialFromSerialLine(line);
          if (credentialToken) {
            await resolveCredential(credentialToken);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function connectNfcReader(auto = false) {
    if (serialConnecting || serialConnected) return;

    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial) {
      setSerialMessage("Web Serial requires Chrome or Edge over HTTPS or localhost.");
      return;
    }

    setSerialConnecting(true);
    setSerialMessage(auto ? "Reconnecting NFC reader..." : "Choose the Arduino NFC reader.");
    try {
      const rememberedPorts = auto ? await serial.getPorts() : [];
      const port = rememberedPorts[0] || (await serial.requestPort());

      serialStopRequestedRef.current = false;
      await port.open({ baudRate: 9600 });
      serialPortRef.current = port;
      setSerialConnected(true);
      setSerialMessage("NFC reader connected. Tap a card or bracelet.");
      window.localStorage.setItem(NFC_READER_AUTO_CONNECT_KEY, "true");
      await readSerialPort(port);
    } catch (err) {
      if (!auto) {
        setSerialMessage(err instanceof Error ? err.message : "Could not connect NFC reader");
      }
      setSerialConnected(false);
    } finally {
      setSerialConnecting(false);
    }
  }

  function clearSelectedStudent() {
    if (!demo) return;
    setDemo({ ...demo, students: [] });
    setSelectedStudentId("");
    setStudentSearch("");
    setStudentSearchResults([]);
    setReceipt(null);
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
                registerName: demo.store.name,
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
          students: []
        });
      }
      setSelectedStudentId("");
      setStudentSearch("");
      setStudentSearchResults([]);
    } catch (err) {
      setCheckoutMessage(err instanceof Error ? err.message : "Sale failed");
    } finally {
      setSelling(false);
    }
  }

  return (
    <section className="module registerModule">
      <PageHeader eyebrow="Cashier workflow" title="Cafeteria Register">
        <button type="button" onClick={loadRegisterData} disabled={loading}>
          {loading ? "Loading..." : "Reload products"}
        </button>
      </PageHeader>

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
            serialSupported={serialSupported}
            serialConnecting={serialConnecting || resolvingCredential}
            serialConnected={serialConnected}
            serialMessage={serialMessage}
            onSearchChange={setStudentSearch}
            onSearchSubmit={() => {
              void searchStudents();
            }}
            onStudentResultSelect={(student) => {
              void selectSearchResult(student);
            }}
            onStudentSelect={(studentId) => {
              setSelectedStudentId(studentId);
              setReceipt(null);
            }}
            onClearStudent={clearSelectedStudent}
            onNfcConnect={() => {
              void connectNfcReader();
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
