import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const source = await readFile(new URL('src/app/procurement/InventoryReadinessPage.tsx', root), 'utf8');
const page = source.replace('import { usePermission } from "../hooks/usePermission";', 'const usePermission = (_permission: string) => true;')
  .replaceAll('from "../', 'from "/src/app/').replaceAll('from "./components/', 'from "/src/app/procurement/components/');
await writeFile(new URL('inventory-page.tsx', import.meta.url), page);
