import { apiGet } from "./api";
import type { Organization, Product, Store } from "./demoTypes";

export type RegisterContext = {
  organization: Organization;
  store: Store;
  products: Product[];
};

export async function loadCurrentOrganization(): Promise<Organization> {
  const organizations = await apiGet<Organization[]>("/organizations?scope=mine");
  const organization = organizations[0];

  if (!organization) {
    throw new Error("No organization is assigned to this staff account.");
  }

  return organization;
}

export async function loadCurrentStore(organizationId: string): Promise<Store> {
  const stores = await apiGet<Store[]>(`/stores?organizationId=${organizationId}`);
  const store = stores[0];

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
