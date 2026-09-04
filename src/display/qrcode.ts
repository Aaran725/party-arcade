import QRCode from "qrcode";

export async function renderQrCode(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: 260,
    margin: 1,
    color: { dark: "#0b0b12ff", light: "#ffffffff" },
    errorCorrectionLevel: "M",
  });
}
