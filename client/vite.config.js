import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`,
      },
    },
  },
  base: "/", // Important for Vercel deployment
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000", // Only for local development
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: "https://news-hub-app-dusky.vercel.app", // For Vercel preview
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
