import qrcode from "qrcode-generator";
import { useMemo } from "react";
import styles from "./OpenOnPhone.module.css";

const QUIET_ZONE = 4;

/** Builds an SVG path for the QR modules, one rectangle per horizontal run of dark modules. */
function qrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      let run = 1;
      while (col + run < count && qr.isDark(row, col + run)) run++;
      path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
      col += run - 1;
    }
  }
  return { size: count + QUIET_ZONE * 2, path };
}

export default function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${value}`}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
