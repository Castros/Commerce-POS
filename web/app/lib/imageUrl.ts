const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";

type ImageOptions = {
  w?: number;
  h?: number;
  fit?: "fill" | "limit" | "thumb" | "crop";
  gravity?: "face" | "center" | "auto";
  radius?: number | "max";
  format?: "auto" | "webp" | "jpg";
  quality?: "auto" | number;
};

export function imageUrl(
  publicId: string | null | undefined,
  opts: ImageOptions = {}
): string {
  if (!publicId || !CLOUD_NAME) return "/default-avatar.svg";

  const {
    w,
    h,
    fit = "fill",
    gravity = "face",
    radius,
    format = "auto",
    quality = "auto",
  } = opts;

  const transforms: string[] = [`c_${fit}`, `g_${gravity}`, `f_${format}`, `q_${quality}`];
  if (w) transforms.push(`w_${w}`);
  if (h) transforms.push(`h_${h}`);
  if (radius !== undefined) transforms.push(`r_${radius}`);

  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transforms.join(",")}/${publicId}`;
}

// Pre-built sizes used across the app — consistent dimensions everywhere
export const avatarUrl = {
  /** 40×40 circle — POS register student chip, table rows */
  xs: (id?: string | null) => imageUrl(id, { w: 40, h: 40, radius: "max" }),
  /** 64×64 circle — detail panels, dashboard cards */
  sm: (id?: string | null) => imageUrl(id, { w: 64, h: 64, radius: "max" }),
  /** 120×120 — profile header */
  md: (id?: string | null) => imageUrl(id, { w: 120, h: 120, radius: "max" }),
  /** 400×400 — store logo / banner (no crop) */
  store: (id?: string | null) =>
    imageUrl(id, { w: 400, h: 400, fit: "limit", gravity: "center" }),
};
