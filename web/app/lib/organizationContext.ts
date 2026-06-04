import { apiGet } from "./api";
import type { Organization, Product, Store } from "./demoTypes";

type CurrentSession = {
  user: {
    id: string;
    organizationId: string;
    role: string;
    storeIds: string[];
  };
};

export type RegisterContext = {
  organization: Organization;
  store: Store;
  products: Product[];
};

export async function loadCurrentSession(): Promise<CurrentSession> {
  return apiGet<CurrentSession>("/auth/me");
}

export async function loadCurrentOrganization(): Promise<Organization> {
  const session = await loadCurrentSession();
  const organizations = await apiGet<Organization[]>("/organizations?scope=mine");
  const organization =
    organizations.find((item) => item.id === session.user.organizationId) || organizations[0];

  if (!organization) {
    throw new Error("No organization is assigned to this staff account.");
  }

  return organization;
}

export async function loadCurrentStore(organizationId: string): Promise<Store> {
  const [stores, session] = await Promise.all([
    apiGet<Store[]>(`/stores?organizationId=${organizationId}`),
    loadCurrentSession().catch(() => null)
  ]);
  const assignedStoreId = session?.user.storeIds[0];
  const store = stores.find((item) => item.id === assignedStoreId) || stores[0];

  if (!store) {
    throw new Error("No store or register location has been configured for this organization.");
  }

  return store;
}

export async function loadRegisterContext(): Promise<RegisterContext> {
  const organization = await loadCurrentOrganization();
  const store = await loadCurrentStore(organization.id);
  const products = await apiGet<Product[]>(
    `/products?organizationId=${organization.id}&storeId=${store.id}`
  );

  return { organization, store, products };
}
