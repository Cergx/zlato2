import { readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const ITEM_MASK_MANIFEST_ID = 'virtual:item-mask-manifest'
const RESOLVED_ITEM_MASK_MANIFEST_ID = `\0${ITEM_MASK_MANIFEST_ID}`

const itemMaskManifest = (): Plugin => ({
  name: 'item-mask-manifest',
  resolveId(id) {
    return id === ITEM_MASK_MANIFEST_ID ? RESOLVED_ITEM_MASK_MANIFEST_ID : undefined
  },
  load(id) {
    if (id !== RESOLVED_ITEM_MASK_MANIFEST_ID) return undefined
    const root = resolve(import.meta.dirname, 'public/assets/items/res')
    const masks: Record<string, string> = {}
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          visit(path)
          continue
        }
        if (!/^a_.*\.bmp$/i.test(entry.name)) continue
        const maskRelativePath = relative(root, path).split(sep).join('/')
        const iconRelativePath = maskRelativePath.replace(/(^|\/)a_([^/]+)$/i, '$1$2')
        masks[`/assets/items/res/${iconRelativePath}`.toLowerCase()] = `/assets/items/res/${maskRelativePath}`
      }
    }
    visit(root)
    return `export default ${JSON.stringify(masks)};`
  },
})


// https://vite.dev/config/
export default defineConfig({
  plugins: [itemMaskManifest(), react()],
  css: {
    modules: {
      generateScopedName: '[name]__[local]__[hash:base64:5]',
    },
  },
  build: {
    assetsDir: 'app',
  },
})
