# ImageKit Pro (BulkImage-Standardization)

A browser-based tool for preparing e-commerce product photos in bulk. Upload a batch of images, group them by SKU, and export standardized, size-optimized images ready for your online store — all without uploading files to a server.

## Features

- **Bulk upload** of product images with automatic thumbnail generation and lazy-loaded grids for smooth browsing of large batches
- **SKU grouping** — match and organize images against a list of SKUs/HAN codes, with clear handling of unmatched or skipped items
- **AI background removal** powered by `@imgly/background-removal`, running entirely client-side
- **Size-controlled export** — set a target maximum output size (KiB) per image before processing
- **Zip export** of processed images using `jszip`, plus spreadsheet import/export support via `xlsx`
- **Privacy-first**: all processing happens locally in your browser; no files ever leave your device

## Tech Stack

- [React 19](https://react.dev/) with [TanStack Start](https://tanstack.com/start) and [TanStack Router](https://tanstack.com/router)
- [Vite](https://vitejs.dev/) for build tooling, deployable to Cloudflare via `@cloudflare/vite-plugin`
- [Tailwind CSS](https://tailwindcss.com/) with Radix UI primitives for the component library
- TypeScript throughout

## Getting Started

```bash
# install dependencies
bun install

# start the dev server
bun run dev

# build for production
bun run build
```

## Workflow

1. **Upload** — drop in your product images
2. **Match SKUs** — paste or upload your SKU list and let the app group images automatically
3. **Process & export** — remove backgrounds, generate thumbnails, resize to your target file size, and download everything as a zip

## License

No license specified yet.
