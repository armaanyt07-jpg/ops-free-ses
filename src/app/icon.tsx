import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3a9 9 0 1 0 8.485 12"
            stroke="white"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="18.2" cy="7.6" r="2.3" fill="white" />
        </svg>
      </div>
    ),
    size,
  );
}
