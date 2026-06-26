import fs from 'fs'
import path from 'path'

const dir = path.join('server', 'routes')
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.ts')) continue
  const fp = path.join(dir, file)
  let src = fs.readFileSync(fp, 'utf8')
  if (!src.includes('req.params.')) continue

  if (!src.includes("from '../utils/routeParam.js'")) {
    const importEnd = src.indexOf('\n\n')
    const insertAt = importEnd === -1 ? 0 : importEnd + 2
    src =
      src.slice(0, insertAt) +
      "import { routeParam } from '../utils/routeParam.js'\n" +
      src.slice(insertAt)
  }

  src = src.replace(/routeParam\(routeParam\(/g, 'routeParam(')
  src = src.replace(/req\.params\.([a-zA-Z0-9_]+)/g, 'routeParam(req.params.$1)')
  fs.writeFileSync(fp, src)
  console.log('updated', file)
}
