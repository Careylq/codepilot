import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "CodePilot",
  description: "代码仓库问答 Agent",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
