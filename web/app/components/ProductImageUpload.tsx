"use client";

import { useRef, useState } from "react";
import { useLanguage } from "../lib/i18n/LanguageContext";

type Props = {
  currentUrl?: string | null;
  organizationId: string;
  onUploaded: (url: string) => void;
};

export default function ProductImageUpload({ currentUrl, organizationId, onUploaded }: Props) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const displayUrl = preview ?? currentUrl ?? null;

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError(t("products.image.imagesOnly")); return; }
    if (file.size > 10 * 1024 * 1024) { setError(t("products.image.maxSize")); return; }

    setError("");
    setBusy(true);

    try {
      const sigRes = await fetch(
        `/api/v1/uploads/signature?folder=product&organizationId=${organizationId}`,
        { credentials: "include" }
      );
      if (!sigRes.ok) throw new Error(t("products.image.credentialError"));
      const { data: sig } = await sigRes.json() as { data: { signature: string; timestamp: number; api_key: string; cloud_name: string; folder: string; upload_preset: string } };

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.api_key);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("folder", sig.folder);
      form.append("upload_preset", sig.upload_preset);

      const cldRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`,
        { method: "POST", body: form }
      );
      if (!cldRes.ok) throw new Error(t("products.image.uploadFailed"));
      const cldData = await cldRes.json() as { secure_url: string };

      setPreview(cldData.secure_url);
      onUploaded(cldData.secure_url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("products.image.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="productImageUpload">
      <div
        className={`productImageUploadBox${busy ? " busy" : ""}`}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && !busy && inputRef.current?.click()}
        title={t("products.image.clickHint")}
      >
        {displayUrl ? (
          <img src={displayUrl} alt="Product" className="productImageUploadPreview" />
        ) : (
          <div className="productImageUploadPlaceholder">
            <span className="material-symbols-outlined">add_photo_alternate</span>
            <span>{t("products.image.upload")}</span>
          </div>
        )}
        <div className="productImageUploadOverlay">
          {busy
            ? <span className="material-symbols-outlined rotating">progress_activity</span>
            : <span className="material-symbols-outlined">photo_camera</span>}
        </div>
      </div>
      {error && (
        <p className="productImageUploadError">{error}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
