import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@/app": path.resolve(import.meta.dirname, "src/app"),
      "@/features": path.resolve(import.meta.dirname, "src/features"),
      "@/shared": path.resolve(import.meta.dirname, "src/shared"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
