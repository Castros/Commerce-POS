import type { DemoStudent, Product, StudentAppSearchResult } from "../lib/demoTypes";

export type CartLine = {
  product: Product;
  quantity: number;
};

export type PaymentMethod = "wallet" | "cash" | "card";

export type RegisterSearchResult =
  | {
      source: "pos";
      id: string;
      name: string;
      externalId: string | null;
      email: string | null;
      classroomLabel: string;
      customer: Omit<DemoStudent, "wallet">;
      wallet: DemoStudent["wallet"] | null;
    }
  | {
      source: "student_app";
      id: string;
      name: string;
      externalId: string | null;
      email: string | null;
      classroomLabel: string;
      student: StudentAppSearchResult;
    };
