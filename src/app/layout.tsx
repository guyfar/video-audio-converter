import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video to Audio Converter - Extract Audio from Video",
  description: "Free online video to audio converter. Extract audio from MP4, AVI, MOV, MKV files. 100% private - all processing happens in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 dark:bg-gray-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
