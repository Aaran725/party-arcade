/** Front-camera access for Snap Judgment — one still frame per round, never a live stream to the display. */
export async function requestCameraStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
  } catch {
    return null;
  }
}

export function capturePhoto(video: HTMLVideoElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 480;
  canvas.height = video.videoHeight || 640;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
