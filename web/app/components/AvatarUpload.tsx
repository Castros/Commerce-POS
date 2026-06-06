"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { avatarUrl } from "../lib/imageUrl";

type Props = {
  publicId:       string | null | undefined;
  entityType:     "staff" | "student" | "guardian" | "store";
  entityId:       string;
  organizationId: string;
  size?:          number;
  shape?:         "circle" | "square";
  onUploaded:     (newPublicId: string) => void;
};

export default function AvatarUpload({
  publicId,
  entityType,
  entityId,
  organizationId,
  size = 64,
  shape = "circle",
  onUploaded,
}: Props) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");

  const src = entityType === "store"
    ? avatarUrl.store(publicId)
    : size <= 48 ? avatarUrl.xs(publicId) : avatarUrl.sm(publicId);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError("Solo imágenes"); return; }
    if (file.size > 10 * 1024 * 1024)   { setError("Máximo 10 MB");  return; }

    setError("");
    setBusy(true);

    try {
      // 1. Get signature from our API
      const sigRes = await fetch(
        `/api/v1/uploads/signature?folder=${entityType}`,
        { credentials: "include" }
      );
      if (!sigRes.ok) throw new Error("Error al obtener firma");
      const { data: sig } = await sigRes.json();

      // 2. Upload directly to Cloudinary (browser → Cloudinary, never through our API)
      const form = new FormData();
      form.append("file", file);
      form.append("api_key",       sig.api_key);
      form.append("timestamp",     String(sig.timestamp));
      form.append("signature",     sig.signature);
      form.append("folder",        sig.folder);
      form.append("upload_preset", sig.upload_preset);

      const cldRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`,
        { method: "POST", body: form }
      );
      if (!cldRes.ok) throw new Error("Error al subir imagen");
      const cldData = await cldRes.json();
      const newPublicId: string = cldData.public_id;

      // 3. Commit — deletes old Cloudinary image and persists new public_id
      const patchRes = await fetch("/api/v1/uploads/commit", {
        method:      "PATCH",
        credentials: "include",
        headers:     { "content-type": "application/json" },
        body:        JSON.stringify({ entityType, entityId, organizationId, newPublicId }),
      });
      if (!patchRes.ok) throw new Error("Error al guardar imagen");

      onUploaded(newPublicId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatarUploadWrap" style={{ "--avatar-size": `${size}px` } as React.CSSProperties}>
      <div
        className={`avatarPreview ${shape === "circle" ? "circle" : "square"} ${busy ? "busy" : ""}`}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        title="Cambiar imagen"
      >
        <Image
          src={src}
          alt="avatar"
          width={size}
          height={size}
          style={{ objectFit: "cover", width: size, height: size }}
          unoptimized={!publicId}
        />
        <div className="avatarOverlay">
          {busy
            ? <span className="material-symbols-outlined rotating">progress_activity</span>
            : <span className="material-symbols-outlined">photo_camera</span>}
        </div>
      </div>

      {error && (
        <p style={{ fontSize: "0.75rem", color: "#ef4444", margin: "4px 0 0", textAlign: "center" }}>
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
